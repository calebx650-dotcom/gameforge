import type { AgentMode, ChatMessage, OperationLogEntry, ToolCall } from "@gameforge/shared";
import type { GenerateResult, LLMProvider } from "@gameforge/llm";
import { ToolExecutor, type TaskPlanSnapshot } from "@gameforge/tools";
import { buildVideoAnalysisMessage } from "@gameforge/vision";

export interface AgentOptions {
  provider: LLMProvider;
  model: string;
  systemPrompt: string;
  executor: ToolExecutor;
  /** Current operating mode; the executor consults this for every tool call. */
  mode: AgentMode;
  /** Hard cap on think/act cycles for a single run(), regardless of mode. */
  maxIterations?: number;
  /**
   * Hard cap on total wall-clock time for a single run(), regardless of
   * mode — primarily meant for autonomous mode, where nothing else stops
   * a run that keeps finding tool calls to make. Checked between
   * iterations, not mid-tool-call (a single slow tool call can still run
   * past this budget; it will simply be the last one).
   */
  maxWallClockMs?: number;
  /**
   * Hard cap on the number of successful file mutations (create_file/
   * edit_file/delete_file) in a single run() — a second, independent lever
   * from maxIterations for bounding how much of the project an autonomous
   * run can touch before stopping to check in.
   */
  maxFileModifications?: number;
  /**
   * Hard cap on *consecutive* tool-call failures (reset to zero by any
   * successful tool call) — bounds a run that's stuck calling the same
   * broken tool over and over (a misconfigured engine bridge, a vendor
   * that's down) instead of burning the full iteration budget on repeats
   * of the same failure before giving up. Defaults to 3.
   */
  maxConsecutiveToolFailures?: number;
  temperature?: number;
  maxOutputTokens?: number;
  onLogEntry?: (entry: OperationLogEntry) => void;
  /**
   * When provided, each iteration calls `provider.stream()` instead of
   * `generate()` and invokes this with every incremental text chunk as it
   * arrives, so a caller (e.g. the chat UI) can render the response as it's
   * generated rather than waiting for the whole turn to finish. The
   * streamed chunks are still accumulated into the same result shape
   * `generate()` would have returned, so the rest of the loop (tool
   * dispatch, message history, logging) is identical either way. Omit this
   * to keep the non-streaming `generate()` path.
   */
  onTextDelta?: (delta: string) => void;
  signal?: AbortSignal;
}

export interface AgentRunResult {
  messages: ChatMessage[];
  log: OperationLogEntry[];
  iterations: number;
  stoppedReason: "completed" | "max_iterations" | "cancelled" | "timed_out" | "file_limit_reached" | "repeated_failures";
  /**
   * Whatever plan/requirement bookkeeping the model recorded via
   * `set_plan`/`set_requirements`/`update_requirement_status` during this
   * run (see `packages/tools`' `TaskPlanTracker`) — empty if it never
   * called them, since nothing requires it to. This is the P2 "did the
   * agent know if it did the right thing" record: a plan alone isn't a
   * verification claim, but a requirement marked `"met"` is only as
   * trustworthy as whatever the model actually checked before setting it.
   */
  taskPlan: TaskPlanSnapshot;
}

const DEFAULT_MAX_ITERATIONS = 10;
const DEFAULT_MAX_CONSECUTIVE_TOOL_FAILURES = 3;
const MUTATING_FILE_TOOLS = new Set(["create_file", "edit_file", "delete_file"]);

/**
 * Drives the think -> act -> observe loop: ask the model for the next
 * step, execute any tool calls it requests through the permission-gated
 * ToolExecutor, feed results back, and repeat until the model stops
 * requesting tools or a safety limit is hit. This is the only place that
 * ties an LLMProvider to the tool system.
 */
export class Agent {
  private readonly log: OperationLogEntry[] = [];
  private fileModificationCount = 0;
  private consecutiveToolFailures = 0;

  constructor(private readonly options: AgentOptions) {}

  async run(conversation: ChatMessage[]): Promise<AgentRunResult> {
    const messages: ChatMessage[] = [
      { role: "system", content: this.options.systemPrompt },
      ...conversation,
    ];
    const maxIterations = this.options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    const startedAt = Date.now();

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      if (this.options.signal?.aborted) {
        return this.buildResult(messages, iteration - 1, "cancelled");
      }
      if (this.options.maxWallClockMs != null && Date.now() - startedAt > this.options.maxWallClockMs) {
        this.record({
          timestamp: Date.now(),
          kind: "error",
          summary: `Stopped: exceeded wall-clock limit of ${this.options.maxWallClockMs}ms.`,
        });
        return this.buildResult(messages, iteration - 1, "timed_out");
      }

      const generateOptions = {
        model: this.options.model,
        messages,
        tools: this.options.executor.getAvailableTools(),
        temperature: this.options.temperature,
        maxOutputTokens: this.options.maxOutputTokens,
        signal: this.options.signal,
      };
      const result = this.options.onTextDelta
        ? await collectStreamedResult(this.options.provider.stream(generateOptions), this.options.onTextDelta)
        : await this.options.provider.generate(generateOptions);

      messages.push(result.message);
      this.record({
        timestamp: Date.now(),
        kind: "message",
        summary: result.toolCalls?.length
          ? `Assistant requested ${result.toolCalls.length} tool call(s)`
          : "Assistant produced a final response",
      });

      if (!result.toolCalls || result.toolCalls.length === 0) {
        return this.buildResult(messages, iteration, "completed");
      }

      const maxConsecutiveToolFailures = this.options.maxConsecutiveToolFailures ?? DEFAULT_MAX_CONSECUTIVE_TOOL_FAILURES;
      for (const call of result.toolCalls) {
        await this.executeAndRecord(call, messages);
        if (this.options.maxFileModifications != null && this.fileModificationCount >= this.options.maxFileModifications) {
          this.record({
            timestamp: Date.now(),
            kind: "error",
            summary: `Stopped: reached the limit of ${this.options.maxFileModifications} file modification(s) for this run.`,
          });
          return this.buildResult(messages, iteration, "file_limit_reached");
        }
        if (this.consecutiveToolFailures >= maxConsecutiveToolFailures) {
          this.record({
            timestamp: Date.now(),
            kind: "error",
            summary: `Stopped: ${this.consecutiveToolFailures} consecutive tool call failures — the model appears stuck on a broken tool rather than making progress.`,
          });
          return this.buildResult(messages, iteration, "repeated_failures");
        }
      }
    }

    return this.buildResult(messages, maxIterations, "max_iterations");
  }

  private buildResult(messages: ChatMessage[], iterations: number, stoppedReason: AgentRunResult["stoppedReason"]): AgentRunResult {
    return {
      messages,
      log: this.log,
      iterations,
      stoppedReason,
      taskPlan: this.options.executor.getTaskPlanTracker().snapshot(),
    };
  }

  private async executeAndRecord(call: ToolCall, messages: ChatMessage[]): Promise<void> {
    this.record({ timestamp: Date.now(), kind: "tool_call", summary: `${call.name}(${summarizeArgs(call)})`, detail: call });
    const toolResult = await this.options.executor.execute(call, this.options.mode, this.options.signal);
    messages.push(toolResult);
    this.record({
      timestamp: Date.now(),
      kind: toolResult.isError ? "error" : "tool_result",
      summary: toolResult.isError ? `${call.name} failed: ${toolResult.content}` : `${call.name} succeeded`,
      detail: toolResult,
    });

    this.consecutiveToolFailures = toolResult.isError ? this.consecutiveToolFailures + 1 : 0;

    if (!toolResult.isError && MUTATING_FILE_TOOLS.has(call.name)) {
      this.fileModificationCount++;
    }

    if (call.name === "capture_screenshot" && !toolResult.isError) {
      this.spliceScreenshotForAnalysis(toolResult.content, messages);
    }
  }

  /**
   * capture_screenshot's tool result is just JSON metadata (a
   * ToolResultMessage's content is always a string) — the model can't
   * "see" the picture from that alone. Right after the tool result, this
   * appends a separate user-role message carrying the actual image plus a
   * vision-analysis prompt (packages/vision's buildVideoAnalysisMessage),
   * so the very next generate() call gives the model something to look
   * at instead of just a filename. This is what turns "capture a
   * screenshot" into an actual visual feedback loop rather than a tool
   * call that produces an opaque blob the model never sees.
   */
  private spliceScreenshotForAnalysis(toolResultContent: string, messages: ChatMessage[]): void {
    let base64Png: string | undefined;
    try {
      base64Png = JSON.parse(toolResultContent).base64Png;
    } catch {
      return;
    }
    if (!base64Png) return;

    const visionMessage = buildVideoAnalysisMessage([{ base64Png }], {
      label: "engine screenshot",
      focus: "whatever the current task is asking you to verify or change",
    });
    messages.push(visionMessage);
    this.record({ timestamp: Date.now(), kind: "message", summary: "Attached captured screenshot for visual analysis" });
  }

  private record(entry: OperationLogEntry): void {
    this.log.push(entry);
    this.options.onLogEntry?.(entry);
  }
}

/**
 * Drains an LLMProvider.stream() generator into the same GenerateResult
 * shape generate() returns, calling onTextDelta as each chunk arrives.
 * Every provider's stream() only emits toolCalls/usage once, on its final
 * chunk (see packages/llm's provider implementations), so simply keeping
 * the latest non-empty value of each is enough to accumulate correctly.
 */
async function collectStreamedResult(
  stream: AsyncGenerator<{ textDelta?: string; toolCalls?: ToolCall[]; usage?: GenerateResult["usage"] }>,
  onTextDelta: (delta: string) => void,
): Promise<GenerateResult> {
  let text = "";
  let toolCalls: ToolCall[] | undefined;
  let usage: GenerateResult["usage"];
  for await (const chunk of stream) {
    if (chunk.textDelta) {
      text += chunk.textDelta;
      onTextDelta(chunk.textDelta);
    }
    if (chunk.toolCalls?.length) toolCalls = chunk.toolCalls;
    if (chunk.usage) usage = chunk.usage;
  }
  return { message: { role: "assistant", content: text, toolCalls }, toolCalls, usage };
}

function summarizeArgs(call: ToolCall): string {
  return Object.entries(call.arguments)
    .map(([k, v]) => `${k}=${JSON.stringify(v).slice(0, 80)}`)
    .join(", ");
}
