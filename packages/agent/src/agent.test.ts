import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GenerateOptions } from "@gameforge/shared";
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
});
