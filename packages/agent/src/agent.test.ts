import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GenerateChunk, GenerateOptions } from "@gameforge/shared";
import type { GenerateResult, LLMProvider } from "@gameforge/llm";
import { ToolExecutor, WorkspaceGuard } from "@gameforge/tools";
import { Agent } from "./agent.js";

class ScriptedProvider implements LLMProvider {
  readonly id = "scripted";
  readonly displayName = "Scripted";
  readonly supportsVision = false;
  readonly supportsTools = true;
  private callIndex = 0;

  constructor(private readonly script: GenerateResult[]) {}

  async listModels() {
    return [];
  }

  async generate(_options: GenerateOptions): Promise<GenerateResult> {
    const result = this.script[Math.min(this.callIndex, this.script.length - 1)];
    this.callIndex++;
    return result;
  }

  async *stream(): AsyncGenerator<never, void, unknown> {
    throw new Error("not used in tests");
  }
}

/** Turns each scripted GenerateResult into a small sequence of streamed chunks, splitting text content into token-sized pieces. */
class StreamingScriptedProvider implements LLMProvider {
  readonly id = "streaming-scripted";
  readonly displayName = "Streaming Scripted";
  readonly supportsVision = false;
  readonly supportsTools = true;
  private callIndex = 0;

  constructor(private readonly script: GenerateResult[]) {}

  async listModels() {
    return [];
  }

  async generate(): Promise<GenerateResult> {
    throw new Error("not used in tests");
  }

  async *stream(_options: GenerateOptions): AsyncGenerator<GenerateChunk, void, unknown> {
    const result = this.script[Math.min(this.callIndex, this.script.length - 1)];
    this.callIndex++;
    const text = typeof result.message.content === "string" ? result.message.content : "";
    for (const word of text.length ? text.split(/(?<= )/) : []) {
      yield { textDelta: word };
    }
    yield { toolCalls: result.toolCalls, done: true, usage: result.usage };
  }
}

async function makeProject() {
  const root = await mkdtemp(join(tmpdir(), "gf-agent-"));
  await writeFile(join(root, "hello.txt"), "hello world\n");
  return root;
}

describe("Agent", () => {
  it("drives read -> edit -> run_command -> final response to completion", async () => {
    const root = await makeProject();
    const guard = new WorkspaceGuard(root);
    const executor = new ToolExecutor(guard, async () => true);

    const provider = new ScriptedProvider([
      {
        message: { role: "assistant", content: "" },
        toolCalls: [{ id: "1", name: "read_file", arguments: { path: "hello.txt" } }],
      },
      {
        message: { role: "assistant", content: "" },
        toolCalls: [
          { id: "2", name: "edit_file", arguments: { path: "hello.txt", oldText: "hello", newText: "goodbye" } },
        ],
      },
      {
        message: { role: "assistant", content: "" },
        toolCalls: [{ id: "3", name: "run_command", arguments: { command: "echo done" } }],
      },
      { message: { role: "assistant", content: "All done: file edited and command ran." } },
    ]);

    const agent = new Agent({
      provider,
      model: "test-model",
      systemPrompt: "You are GameForge.",
      executor,
      mode: "build",
      maxIterations: 10,
    });

    const result = await agent.run([{ role: "user", content: "Change hello to goodbye and confirm." }]);

    expect(result.stoppedReason).toBe("completed");
    expect(result.iterations).toBe(4);
    const content = await readFile(join(root, "hello.txt"), "utf-8");
    expect(content).toBe("goodbye world\n");
    expect(result.log.some((e) => e.kind === "tool_call" && e.summary.includes("read_file"))).toBe(true);
    expect(result.log.some((e) => e.kind === "tool_result")).toBe(true);

    // Real timing data (P4 performance instrumentation), not fabricated placeholders.
    expect(result.timing.startedAt).toBeGreaterThan(0);
    expect(result.timing.endedAt).toBeGreaterThanOrEqual(result.timing.startedAt);
    expect(result.timing.wallClockMs).toBe(result.timing.endedAt - result.timing.startedAt);
    expect(result.timing.perToolCall.read_file).toMatchObject({ callCount: 1, errorCount: 0 });
    expect(result.timing.perToolCall.read_file.totalMs).toBeGreaterThanOrEqual(0);
    expect(result.timing.perToolCall.edit_file).toMatchObject({ callCount: 1, errorCount: 0 });
    expect(result.timing.perToolCall.run_command).toMatchObject({ callCount: 1, errorCount: 0 });
  });

  it("accumulates per-tool-call timing across multiple calls to the same tool, including error counts", async () => {
    const root = await makeProject();
    const executor = new ToolExecutor(new WorkspaceGuard(root), async () => true);
    const provider = new ScriptedProvider([
      { message: { role: "assistant", content: "" }, toolCalls: [{ id: "1", name: "read_file", arguments: { path: "hello.txt" } }] },
      { message: { role: "assistant", content: "" }, toolCalls: [{ id: "2", name: "read_file", arguments: { path: "nonexistent.txt" } }] },
      { message: { role: "assistant", content: "done" } },
    ]);
    const agent = new Agent({ provider, model: "m", systemPrompt: "sys", executor, mode: "build", maxIterations: 10 });

    const result = await agent.run([{ role: "user", content: "read some files" }]);

    expect(result.timing.perToolCall.read_file.callCount).toBe(2);
    expect(result.timing.perToolCall.read_file.errorCount).toBe(1);
  });

  it("stops at max_iterations if the model never stops requesting tools", async () => {
    const root = await makeProject();
    const executor = new ToolExecutor(new WorkspaceGuard(root), async () => true);
    const alwaysReadFile: GenerateResult = {
      message: { role: "assistant", content: "" },
      toolCalls: [{ id: "x", name: "read_file", arguments: { path: "hello.txt" } }],
    };
    const provider = new ScriptedProvider([alwaysReadFile]);

    const agent = new Agent({
      provider,
      model: "test-model",
      systemPrompt: "sys",
      executor,
      mode: "build",
      maxIterations: 3,
    });

    const result = await agent.run([{ role: "user", content: "loop forever" }]);
    expect(result.stoppedReason).toBe("max_iterations");
    expect(result.iterations).toBe(3);
  });

  it("denies a write tool in ask mode without ever touching the file", async () => {
    const root = await makeProject();
    const executor = new ToolExecutor(new WorkspaceGuard(root), async () => true);
    const provider = new ScriptedProvider([
      {
        message: { role: "assistant", content: "" },
        toolCalls: [{ id: "1", name: "edit_file", arguments: { path: "hello.txt", oldText: "hello", newText: "x" } }],
      },
      { message: { role: "assistant", content: "Understood, ask mode is read-only." } },
    ]);

    const agent = new Agent({ provider, model: "m", systemPrompt: "sys", executor, mode: "ask" });
    const result = await agent.run([{ role: "user", content: "edit the file" }]);

    const content = await readFile(join(root, "hello.txt"), "utf-8");
    expect(content).toBe("hello world\n");
    expect(result.log.some((e) => e.kind === "error")).toBe(true);
  });

  it("splices an image message after a successful capture_screenshot tool call so the model actually sees the picture", async () => {
    const root = await makeProject();
    const fakeBridge = {
      id: "fake-engine",
      displayName: "Fake Engine",
      connect: async () => {},
      disconnect: async () => {},
      isConnected: () => true,
      inspectScene: async () => ({ name: "Scene", objects: [] }),
      inspectObject: async () => {
        throw new Error("not used");
      },
      createObject: async () => {
        throw new Error("not used");
      },
      modifyObject: async () => {},
      modifyTransform: async () => {},
      modifyComponent: async () => {},
      saveScene: async () => {},
      enterPlayMode: async () => {},
      exitPlayMode: async () => {},
      buildProject: async () => ({ success: true }),
      captureScreenshot: async () => ({ base64Png: "fakeBase64ImageData" }),
      readConsole: async () => [],
    };
    const executor = new ToolExecutor(new WorkspaceGuard(root), async () => true, {}, fakeBridge as any);

    const receivedMessageSnapshots: unknown[][] = [];
    class RecordingProvider extends ScriptedProvider {
      async generate(options: GenerateOptions) {
        receivedMessageSnapshots.push(structuredClone(options.messages));
        return super.generate(options);
      }
    }
    const provider = new RecordingProvider([
      { message: { role: "assistant", content: "" }, toolCalls: [{ id: "1", name: "capture_screenshot", arguments: {} }] },
      { message: { role: "assistant", content: "I see the screenshot." } },
    ]);

    const agent = new Agent({ provider, model: "m", systemPrompt: "sys", executor, mode: "build" });
    const result = await agent.run([{ role: "user", content: "Check how the level looks." }]);

    expect(result.stoppedReason).toBe("completed");
    // The second generate() call (index 1) should include the spliced-in vision message with the image.
    const secondCallMessages = receivedMessageSnapshots[1] as Array<{ role: string; content: unknown }>;
    const visionMessage = secondCallMessages[secondCallMessages.length - 1];
    expect(visionMessage.role).toBe("user");
    const parts = visionMessage.content as Array<{ type: string; data?: string }>;
    expect(parts.some((p) => p.type === "image" && p.data === "fakeBase64ImageData")).toBe(true);
    expect(result.log.some((e) => e.summary.includes("Attached captured screenshot"))).toBe(true);
  });

  it("stops with timed_out once the wall-clock budget is exceeded, without waiting for another provider call", async () => {
    const root = await makeProject();
    const executor = new ToolExecutor(new WorkspaceGuard(root), async () => true);
    const alwaysReadFile: GenerateResult = {
      message: { role: "assistant", content: "" },
      toolCalls: [{ id: "x", name: "read_file", arguments: { path: "hello.txt" } }],
    };
    const provider = new ScriptedProvider([alwaysReadFile]);

    const agent = new Agent({
      provider,
      model: "m",
      systemPrompt: "sys",
      executor,
      mode: "build",
      maxIterations: 1000,
      maxWallClockMs: 0, // already "expired" by the time the first check runs
    });

    const result = await agent.run([{ role: "user", content: "loop forever" }]);
    expect(result.stoppedReason).toBe("timed_out");
    expect(result.iterations).toBeLessThan(1000); // stopped well short of maxIterations
  });

  it("stops with file_limit_reached once the file-modification cap is hit, mid-run", async () => {
    const root = await makeProject();
    const executor = new ToolExecutor(new WorkspaceGuard(root), async () => true);
    const provider = new ScriptedProvider([
      {
        message: { role: "assistant", content: "" },
        toolCalls: [
          { id: "1", name: "edit_file", arguments: { path: "hello.txt", oldText: "hello", newText: "h1" } },
          { id: "2", name: "edit_file", arguments: { path: "hello.txt", oldText: "h1", newText: "h2" } },
          { id: "3", name: "edit_file", arguments: { path: "hello.txt", oldText: "h2", newText: "h3" } },
        ],
      },
      { message: { role: "assistant", content: "should never be reached" } },
    ]);

    const agent = new Agent({ provider, model: "m", systemPrompt: "sys", executor, mode: "build", maxFileModifications: 2 });
    const result = await agent.run([{ role: "user", content: "make three edits" }]);

    expect(result.stoppedReason).toBe("file_limit_reached");
    const content = await readFile(join(root, "hello.txt"), "utf-8");
    expect(content).toBe("h2 world\n"); // third edit_file call never ran
  });

  it("does not count failed file mutations toward the modification cap", async () => {
    const root = await makeProject();
    const executor = new ToolExecutor(new WorkspaceGuard(root), async () => true);
    const provider = new ScriptedProvider([
      {
        message: { role: "assistant", content: "" },
        toolCalls: [{ id: "1", name: "edit_file", arguments: { path: "hello.txt", oldText: "not-present", newText: "x" } }],
      },
      { message: { role: "assistant", content: "done" } },
    ]);

    const agent = new Agent({ provider, model: "m", systemPrompt: "sys", executor, mode: "build", maxFileModifications: 1 });
    const result = await agent.run([{ role: "user", content: "try an edit that will fail" }]);

    expect(result.stoppedReason).toBe("completed"); // the failed edit didn't count against the cap
  });

  it("sends the session's scoped tool list, not the full static TOOL_DEFINITIONS, to the provider", async () => {
    const root = await makeProject();
    // No engine bridge and no generation providers configured for this executor,
    // so engine tools and vendor-backed generation tools should be excluded.
    const executor = new ToolExecutor(new WorkspaceGuard(root), async () => true);

    let sentToolNames: string[] = [];
    class RecordingProvider extends ScriptedProvider {
      async generate(options: GenerateOptions) {
        sentToolNames = (options.tools ?? []).map((t) => t.name);
        return super.generate(options);
      }
    }
    const provider = new RecordingProvider([{ message: { role: "assistant", content: "done" } }]);

    const agent = new Agent({ provider, model: "m", systemPrompt: "sys", executor, mode: "build" });
    await agent.run([{ role: "user", content: "hi" }]);

    expect(sentToolNames).toContain("read_file");
    expect(sentToolNames).not.toContain("inspect_scene"); // engine tool, no bridge configured
    expect(sentToolNames).not.toContain("generate_3d_model"); // vendor-backed, no provider configured
    expect(sentToolNames).toContain("generate_level_layout"); // pure, always available
    expect(sentToolNames).toEqual(executor.getAvailableTools().map((t) => t.name));
  });

  it("streams incremental text via onTextDelta when provided, and still drives tool calls to completion", async () => {
    const root = await makeProject();
    const executor = new ToolExecutor(new WorkspaceGuard(root), async () => true);
    const provider = new StreamingScriptedProvider([
      {
        message: { role: "assistant", content: "" },
        toolCalls: [{ id: "1", name: "read_file", arguments: { path: "hello.txt" } }],
      },
      { message: { role: "assistant", content: "The file says hello world." } },
    ]);

    const deltas: string[] = [];
    const agent = new Agent({
      provider,
      model: "m",
      systemPrompt: "sys",
      executor,
      mode: "build",
      onTextDelta: (delta) => deltas.push(delta),
    });

    const result = await agent.run([{ role: "user", content: "read the file and tell me what it says" }]);

    expect(result.stoppedReason).toBe("completed");
    expect(deltas.join("")).toBe("The file says hello world.");
    const finalMessage = result.messages[result.messages.length - 1];
    expect(finalMessage.content).toBe("The file says hello world.");
    expect(result.log.some((e) => e.kind === "tool_call" && e.summary.includes("read_file"))).toBe(true);
  });

  it("does not call stream() when onTextDelta is omitted (default non-streaming path is unchanged)", async () => {
    const root = await makeProject();
    const executor = new ToolExecutor(new WorkspaceGuard(root), async () => true);
    const provider = new ScriptedProvider([{ message: { role: "assistant", content: "done, non-streaming" } }]);

    const agent = new Agent({ provider, model: "m", systemPrompt: "sys", executor, mode: "build" });
    const result = await agent.run([{ role: "user", content: "hi" }]);

    expect(result.stoppedReason).toBe("completed");
    expect(result.messages[result.messages.length - 1].content).toBe("done, non-streaming");
  });

  it("stops immediately when the abort signal is already aborted", async () => {
    const root = await makeProject();
    const executor = new ToolExecutor(new WorkspaceGuard(root), async () => true);
    const provider = new ScriptedProvider([{ message: { role: "assistant", content: "should not be called" } }]);
    const controller = new AbortController();
    controller.abort();

    const agent = new Agent({ provider, model: "m", systemPrompt: "sys", executor, mode: "build", signal: controller.signal });
    const result = await agent.run([{ role: "user", content: "hi" }]);
    expect(result.stoppedReason).toBe("cancelled");
    expect(result.iterations).toBe(0);
  });

  it("includes the model's set_plan/set_requirements/update_requirement_status calls in the result's taskPlan (P2 requirement tracking)", async () => {
    const root = await makeProject();
    const executor = new ToolExecutor(new WorkspaceGuard(root), async () => true);
    const provider = new ScriptedProvider([
      {
        message: { role: "assistant", content: "" },
        toolCalls: [{ id: "1", name: "set_plan", arguments: { steps: ["read the file", "confirm content"] } }],
      },
      {
        message: { role: "assistant", content: "" },
        toolCalls: [{ id: "2", name: "set_requirements", arguments: { requirements: ["file says hello"] } }],
      },
      {
        message: { role: "assistant", content: "" },
        toolCalls: [{ id: "3", name: "read_file", arguments: { path: "hello.txt" } }],
      },
      {
        message: { role: "assistant", content: "" },
        toolCalls: [{ id: "4", name: "update_requirement_status", arguments: { id: 1, status: "met", note: "read the real file" } }],
      },
      { message: { role: "assistant", content: "Confirmed." } },
    ]);

    const agent = new Agent({ provider, model: "m", systemPrompt: "sys", executor, mode: "build", maxIterations: 10 });
    const result = await agent.run([{ role: "user", content: "confirm the file" }]);

    expect(result.stoppedReason).toBe("completed");
    expect(result.taskPlan.plan).toEqual(["read the file", "confirm content"]);
    expect(result.taskPlan.requirements).toEqual([
      { id: 1, description: "file says hello", status: "met", note: "read the real file" },
    ]);
  });

  it("returns an empty taskPlan when the model never uses the planning tools — nothing requires it to", async () => {
    const root = await makeProject();
    const executor = new ToolExecutor(new WorkspaceGuard(root), async () => true);
    const provider = new ScriptedProvider([{ message: { role: "assistant", content: "done, no planning tools used" } }]);

    const agent = new Agent({ provider, model: "m", systemPrompt: "sys", executor, mode: "build" });
    const result = await agent.run([{ role: "user", content: "hi" }]);

    expect(result.taskPlan).toEqual({ plan: [], requirements: [] });
  });

  it("forwards its abort signal all the way into an in-flight tool call, not just the top of the loop", async () => {
    // A regression test for the actual gap: the per-iteration `signal.aborted`
    // check alone doesn't help if a *single* tool call itself hangs — the run
    // only ever cancels between iterations, so an abort during a slow tool
    // call (a long shell command, a slow engine-bridge call) previously had
    // to be waited out. This drives a real run_command sleep through the
    // real ToolExecutor and confirms cancelling mid-call actually kills it
    // quickly instead of running to completion.
    const root = await makeProject();
    const executor = new ToolExecutor(new WorkspaceGuard(root), async () => true);
    const provider = new ScriptedProvider([
      {
        message: { role: "assistant", content: "" },
        toolCalls: [{ id: "1", name: "run_command", arguments: { command: "sleep 30", timeoutMs: 30_000 } }],
      },
      { message: { role: "assistant", content: "should not be reached" } },
    ]);
    const controller = new AbortController();

    const agent = new Agent({ provider, model: "m", systemPrompt: "sys", executor, mode: "build", signal: controller.signal });
    const started = Date.now();
    setTimeout(() => controller.abort(), 50);
    const result = await agent.run([{ role: "user", content: "hi" }]);
    const elapsed = Date.now() - started;

    // Generous margin — this only needs to prove the run didn't wait out the
    // full 30s sleep/timeout, not that it reacted within some tight bound;
    // under a fully parallel `npm test` run, CPU contention can delay the
    // scheduled abort() call itself by a second or more.
    expect(elapsed).toBeLessThan(20_000);
    const toolResultMessage = result.messages.find((m) => m.role === "tool");
    expect(JSON.parse((toolResultMessage as { content: string }).content).exitCode).not.toBe(0);
  }, 25_000);

  it("stops with repeated_failures after enough consecutive tool errors, instead of burning the whole iteration budget", async () => {
    const root = await makeProject();
    const executor = new ToolExecutor(new WorkspaceGuard(root), async () => true);
    // Every attempt calls a nonexistent tool, which always errors - this would
    // otherwise run all the way to max_iterations, one failure at a time.
    const provider = new ScriptedProvider(
      Array.from({ length: 10 }, (_, i) => ({
        message: { role: "assistant" as const, content: "" },
        toolCalls: [{ id: String(i), name: "nonexistent_tool", arguments: {} }],
      })),
    );

    const agent = new Agent({
      provider,
      model: "m",
      systemPrompt: "sys",
      executor,
      mode: "build",
      maxIterations: 10,
      maxConsecutiveToolFailures: 3,
    });
    const result = await agent.run([{ role: "user", content: "do something broken" }]);

    expect(result.stoppedReason).toBe("repeated_failures");
    expect(result.iterations).toBe(3);
  });

  it("resets the consecutive-failure count after a successful tool call, so an occasional error doesn't end the run", async () => {
    const root = await makeProject();
    const executor = new ToolExecutor(new WorkspaceGuard(root), async () => true);
    const provider = new ScriptedProvider([
      { message: { role: "assistant", content: "" }, toolCalls: [{ id: "1", name: "nonexistent_tool", arguments: {} }] },
      { message: { role: "assistant", content: "" }, toolCalls: [{ id: "2", name: "read_file", arguments: { path: "hello.txt" } }] },
      { message: { role: "assistant", content: "" }, toolCalls: [{ id: "3", name: "nonexistent_tool", arguments: {} }] },
      { message: { role: "assistant", content: "" }, toolCalls: [{ id: "4", name: "nonexistent_tool", arguments: {} }] },
      { message: { role: "assistant", content: "all done" } },
    ]);

    const agent = new Agent({
      provider,
      model: "m",
      systemPrompt: "sys",
      executor,
      mode: "build",
      maxIterations: 10,
      maxConsecutiveToolFailures: 3,
    });
    const result = await agent.run([{ role: "user", content: "hi" }]);

    // Two failures happened, but a real success (read_file) sat between them and the
    // trailing pair, so the run should complete normally instead of tripping the guard.
    expect(result.stoppedReason).toBe("completed");
  });

  describe("delegate_subtask (P3.5 multi-agent orchestration)", () => {
    it("spawns a real sub-agent, runs it to completion, and returns its final response to the parent", async () => {
      const root = await makeProject();
      const executor = new ToolExecutor(new WorkspaceGuard(root), async () => true);
      const logEntries: string[] = [];
      // Provider is shared between parent and sub-agent (delegation reuses it), so this
      // one script serves both: parent's turn 1 delegates; the sub-agent's own turn 1
      // (script index 1) finishes immediately; parent's turn 2 (index 2) wraps up.
      const provider = new ScriptedProvider([
        {
          message: { role: "assistant", content: "" },
          toolCalls: [{ id: "1", name: "delegate_subtask", arguments: { task: "say hello" } }],
        },
        { message: { role: "assistant", content: "Sub-agent says hello." } },
        { message: { role: "assistant", content: "Parent acknowledges the sub-agent's result." } },
      ]);

      const agent = new Agent({
        provider,
        model: "m",
        systemPrompt: "sys",
        executor,
        mode: "build",
        maxIterations: 10,
        onLogEntry: (e) => logEntries.push(e.summary),
      });
      const result = await agent.run([{ role: "user", content: "delegate the greeting" }]);

      expect(result.stoppedReason).toBe("completed");
      const delegateResultMessage = result.messages.find((m) => m.role === "tool") as { content: string } | undefined;
      const delegateResult = JSON.parse(delegateResultMessage!.content);
      expect(delegateResult.finalText).toBe("Sub-agent says hello.");
      expect(delegateResult.stoppedReason).toBe("completed");
      // The sub-agent's own activity is visible in the parent's log, distinguishably tagged.
      expect(logEntries.some((s) => s.startsWith("[sub-agent]"))).toBe(true);
    });

    it("refuses to delegate outside build/autonomous mode, without attempting anything", async () => {
      const root = await makeProject();
      const executor = new ToolExecutor(new WorkspaceGuard(root), async () => true);
      const provider = new ScriptedProvider([
        { message: { role: "assistant", content: "" }, toolCalls: [{ id: "1", name: "delegate_subtask", arguments: { task: "do X" } }] },
        { message: { role: "assistant", content: "ok, handled it myself" } },
      ]);

      const agent = new Agent({ provider, model: "m", systemPrompt: "sys", executor, mode: "assist", maxIterations: 5 });
      const result = await agent.run([{ role: "user", content: "hi" }]);

      const toolResultMessage = result.messages.find((m) => m.role === "tool") as { content: string; isError?: boolean } | undefined;
      expect(toolResultMessage?.isError).toBe(true);
      expect(toolResultMessage?.content).toMatch(/requires build or autonomous mode/);
      expect(result.stoppedReason).toBe("completed");
    });

    it("does not offer delegate_subtask to a sub-agent, and refuses it defensively if requested anyway (no recursive chains)", async () => {
      const root = await makeProject();
      const executor = new ToolExecutor(new WorkspaceGuard(root), async () => true);
      let subAgentSawDelegateTool = false;
      class RecordingProvider extends ScriptedProvider {
        async generate(options: GenerateOptions): Promise<GenerateResult> {
          if (options.tools?.some((t) => t.name === "delegate_subtask") && options.messages.some((m) => m.content === "try to delegate again")) {
            subAgentSawDelegateTool = true;
          }
          return super.generate(options);
        }
      }
      const provider = new RecordingProvider([
        { message: { role: "assistant", content: "" }, toolCalls: [{ id: "1", name: "delegate_subtask", arguments: { task: "try to delegate again" } }] },
        // The sub-agent's own turn: even though it isn't offered delegate_subtask, this
        // script forces the call anyway, to prove the defense-in-depth check catches it.
        { message: { role: "assistant", content: "" }, toolCalls: [{ id: "2", name: "delegate_subtask", arguments: { task: "nested" } }] },
        { message: { role: "assistant", content: "sub-agent gave up on nesting" } },
        { message: { role: "assistant", content: "parent done" } },
      ]);

      const agent = new Agent({ provider, model: "m", systemPrompt: "sys", executor, mode: "build", maxIterations: 10 });
      const result = await agent.run([{ role: "user", content: "hi" }]);

      expect(subAgentSawDelegateTool).toBe(false);
      expect(result.stoppedReason).toBe("completed");
      const delegateResultMessage = result.messages.find((m) => m.role === "tool") as { content: string } | undefined;
      const delegateResult = JSON.parse(delegateResultMessage!.content);
      // The sub-agent's forced nested call was refused, but the sub-agent itself still completed.
      expect(delegateResult.finalText).toBe("sub-agent gave up on nesting");
    });

    it("bounds the sub-agent's iteration budget even if a larger one is requested", async () => {
      const root = await makeProject();
      const executor = new ToolExecutor(new WorkspaceGuard(root), async () => true);
      // The sub-agent's script never produces a final text response, so it will only stop
      // via max_iterations - proving the requested 100 was actually capped at 8.
      const provider = new ScriptedProvider([
        {
          message: { role: "assistant", content: "" },
          toolCalls: [{ id: "1", name: "delegate_subtask", arguments: { task: "loop forever", maxIterations: 100 } }],
        },
        { message: { role: "assistant", content: "" }, toolCalls: [{ id: "loop", name: "read_file", arguments: { path: "hello.txt" } }] },
      ]);

      const agent = new Agent({ provider, model: "m", systemPrompt: "sys", executor, mode: "build", maxIterations: 20 });
      const result = await agent.run([{ role: "user", content: "hi" }]);

      const delegateResultMessage = result.messages.find((m) => m.role === "tool") as { content: string } | undefined;
      const delegateResult = JSON.parse(delegateResultMessage!.content);
      expect(delegateResult.stoppedReason).toBe("max_iterations");
      expect(delegateResult.iterations).toBe(8);
    });
  });
});
