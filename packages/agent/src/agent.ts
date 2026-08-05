import type { AgentMode, ChatMessage, OperationLogEntry, ToolCall } from "@gameforge/shared";
import type { LLMProvider } from "@gameforge/llm";
import { TOOL_DEFINITIONS, ToolExecutor } from "@gameforge/tools";

export interface AgentOptions {
  provider: LLMProvider;
  model: string;
  systemPrompt: string;
  executor: ToolExecutor;
  /** Current operating mode; the executor consults this for every tool call. */
  mode: AgentMode;
  /** Hard cap on think/act cycles for a single run(), regardless of mode. */
  maxIterations?: number;
  temperature?: number;
  maxOutputTokens?: number;
  onLogEntry?: (entry: OperationLogEntry) => void;
  signal?: AbortSignal;
}

export interface AgentRunResult {
  messages: ChatMessage[];
  log: OperationLogEntry[];
  iterations: number;
  stoppedReason: "completed" | "max_iterations" | "cancelled";
}

const DEFAULT_MAX_ITERATIONS = 10;

/**
 * Drives the think -> act -> observe loop: ask the model for the next
 * step, execute any tool calls it requests through the permission-gated
 * ToolExecutor, feed results back, and repeat until the model stops
 * requesting tools or a safety limit is hit. This is the only place that
 * ties an LLMProvider to the tool system.
 */
export class Agent {
  private readonly log: OperationLogEntry[] = [];

  constructor(private readonly options: AgentOptions) {}

  async run(conversation: ChatMessage[]): Promise<AgentRunResult> {
    const messages: ChatMessage[] = [
      { role: "system", content: this.options.systemPrompt },
      ...conversation,
    ];
    const maxIterations = this.options.maxIterations ?? DEFAULT_MAX_ITERATIONS;

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      if (this.options.signal?.aborted) {
        return { messages, log: this.log, iterations: iteration - 1, stoppedReason: "cancelled" };
      }

      const result = await this.options.provider.generate({
        model: this.options.model,
        messages,
        tools: TOOL_DEFINITIONS,
        temperature: this.options.temperature,
        maxOutputTokens: this.options.maxOutputTokens,
        signal: this.options.signal,
      });

      messages.push(result.message);
      this.record({
        timestamp: Date.now(),
        kind: "message",
        summary: result.toolCalls?.length
          ? `Assistant requested ${result.toolCalls.length} tool call(s)`
          : "Assistant produced a final response",
      });

      if (!result.toolCalls || result.toolCalls.length === 0) {
        return { messages, log: this.log, iterations: iteration, stoppedReason: "completed" };
      }

      for (const call of result.toolCalls) {
        await this.executeAndRecord(call, messages);
      }
    }

    return { messages, log: this.log, iterations: maxIterations, stoppedReason: "max_iterations" };
  }

  private async executeAndRecord(call: ToolCall, messages: ChatMessage[]): Promise<void> {
    this.record({ timestamp: Date.now(), kind: "tool_call", summary: `${call.name}(${summarizeArgs(call)})`, detail: call });
    const toolResult = await this.options.executor.execute(call, this.options.mode);
    messages.push(toolResult);
    this.record({
      timestamp: Date.now(),
      kind: toolResult.isError ? "error" : "tool_result",
      summary: toolResult.isError ? `${call.name} failed: ${toolResult.content}` : `${call.name} succeeded`,
      detail: toolResult,
    });
  }

  private record(entry: OperationLogEntry): void {
    this.log.push(entry);
    this.options.onLogEntry?.(entry);
  }
}

function summarizeArgs(call: ToolCall): string {
  return Object.entries(call.arguments)
    .map(([k, v]) => `${k}=${JSON.stringify(v).slice(0, 80)}`)
    .join(", ");
}
