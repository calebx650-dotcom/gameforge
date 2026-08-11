import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceGuard } from "./workspace.js";
import { ToolExecutor } from "./executor.js";

async function makeProject() {
  const root = await mkdtemp(join(tmpdir(), "gf-exec-"));
  await writeFile(join(root, "hello.txt"), "hello world\n");
  return root;
}

describe("ToolExecutor", () => {
  it("reads a file without approval, even in ask mode", async () => {
    const root = await makeProject();
    const executor = new ToolExecutor(new WorkspaceGuard(root), async () => true);
    const result = await executor.execute({ id: "1", name: "read_file", arguments: { path: "hello.txt" } }, "ask");
    expect(result.isError).toBeFalsy();
    expect(result.content).toBe("hello world\n");
  });

  it("denies edit_file in ask mode without asking for approval", async () => {
    const root = await makeProject();
    let approvalCalled = false;
    const executor = new ToolExecutor(new WorkspaceGuard(root), async () => {
      approvalCalled = true;
      return true;
    });
    const result = await executor.execute(
      { id: "1", name: "edit_file", arguments: { path: "hello.txt", oldText: "hello", newText: "bye" } },
      "ask",
    );
    expect(result.isError).toBe(true);
    expect(approvalCalled).toBe(false);
  });

  it("asks for approval in assist mode and applies the edit once approved", async () => {
    const root = await makeProject();
    const executor = new ToolExecutor(new WorkspaceGuard(root), async () => true);
    const result = await executor.execute(
      { id: "1", name: "edit_file", arguments: { path: "hello.txt", oldText: "hello", newText: "bye" } },
      "assist",
    );
    expect(result.isError).toBeFalsy();
    const content = await readFile(join(root, "hello.txt"), "utf-8");
    expect(content).toBe("bye world\n");
  });

  it("respects a rejected approval", async () => {
    const root = await makeProject();
    const executor = new ToolExecutor(new WorkspaceGuard(root), async () => false);
    const result = await executor.execute(
      { id: "1", name: "edit_file", arguments: { path: "hello.txt", oldText: "hello", newText: "bye" } },
      "assist",
    );
    expect(result.isError).toBe(true);
    const content = await readFile(join(root, "hello.txt"), "utf-8");
    expect(content).toBe("hello world\n");
  });

  it("allows writes without approval in build mode", async () => {
    const root = await makeProject();
    let approvalCalled = false;
    const executor = new ToolExecutor(new WorkspaceGuard(root), async () => {
      approvalCalled = true;
      return true;
    });
    const result = await executor.execute(
      { id: "1", name: "edit_file", arguments: { path: "hello.txt", oldText: "hello", newText: "bye" } },
      "build",
    );
    expect(result.isError).toBeFalsy();
    expect(approvalCalled).toBe(false);
  });

  it("runs a safe command in build mode", async () => {
    const root = await makeProject();
    const executor = new ToolExecutor(new WorkspaceGuard(root), async () => true);
    const result = await executor.execute({ id: "1", name: "run_command", arguments: { command: "echo hi" } }, "build");
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content).stdout.trim()).toBe("hi");
  });

  it("actually terminates a sleeping command when its own timeout fires, not just when it happens to exit on its own", async () => {
    const root = await makeProject();
    const executor = new ToolExecutor(new WorkspaceGuard(root), async () => true);

    const started = Date.now();
    const result = await executor.execute(
      { id: "1", name: "run_command", arguments: { command: "sleep 30", timeoutMs: 200 } },
      "build",
    );
    const elapsed = Date.now() - started;

    // Generous margin — proving it didn't wait out the full 30s sleep, not
    // enforcing tight timing; a fully parallel `npm test` run can add real
    // scheduling delay.
    expect(elapsed).toBeLessThan(20_000);
    expect(JSON.parse(result.content).timedOut).toBe(true);
  }, 25_000);

  it("kills an in-flight run_command immediately when the passed signal aborts, instead of waiting out its own timeout", async () => {
    const root = await makeProject();
    const executor = new ToolExecutor(new WorkspaceGuard(root), async () => true);
    const controller = new AbortController();

    const started = Date.now();
    const pending = executor.execute(
      { id: "1", name: "run_command", arguments: { command: "sleep 30", timeoutMs: 30_000 } },
      "build",
      controller.signal,
    );
    setTimeout(() => controller.abort(), 50);
    const result = await pending;
    const elapsed = Date.now() - started;

    // The command's own timeout is 30s; a real fix should return well
    // short of that. Generous margin for CPU contention under a fully
    // parallel `npm test` run — this proves it didn't wait out the full
    // sleep/timeout, not tight timing.
    expect(elapsed).toBeLessThan(20_000);
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content).exitCode).not.toBe(0);
  }, 25_000);

  it("requires approval for a dangerous command even in autonomous mode", async () => {
    const root = await makeProject();
    let approvalCalled = false;
    const executor = new ToolExecutor(new WorkspaceGuard(root), async () => {
      approvalCalled = true;
      return false;
    });
    const result = await executor.execute(
      { id: "1", name: "run_command", arguments: { command: "rm -rf /" } },
      "autonomous",
    );
    expect(approvalCalled).toBe(true);
    expect(result.isError).toBe(true);
  });

  it("blocks path traversal outside the workspace", async () => {
    const root = await makeProject();
    const executor = new ToolExecutor(new WorkspaceGuard(root), async () => true);
    const result = await executor.execute({ id: "1", name: "read_file", arguments: { path: "../../etc/passwd" } }, "ask");
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/escapes workspace/);
  });

  it("always requires approval for a costsMoney generation tool, even in autonomous mode, and runs it once approved", async () => {
    const root = await makeProject();
    let approvalReason = "";
    const executor = new ToolExecutor(
      new WorkspaceGuard(root),
      async (_call, reason) => {
        approvalReason = reason;
        return true;
      },
      {},
    );
    const result = await executor.execute(
      { id: "1", name: "generate_level_layout", arguments: { theme: "gothic_cathedral", seed: 1, roomCount: 3 } },
      "autonomous",
    );
    // generate_level_layout is free/local (costsMoney unset), so it should NOT require approval.
    expect(approvalReason).toBe("");
    expect(result.isError).toBeFalsy();
  });

  it("blocks a costsMoney tool without approval and never calls the underlying provider", async () => {
    const root = await makeProject();
    const executor = new ToolExecutor(new WorkspaceGuard(root), async () => false, {});
    const result = await executor.execute(
      { id: "1", name: "generate_3d_model", arguments: { prompt: "gargoyle" } },
      "autonomous",
    );
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/declined to approve/);
  });

  it("requires approval for generate_3d_model even in build mode, then reports a missing-provider error once approved", async () => {
    const root = await makeProject();
    let wasAskedForApproval = false;
    const executor = new ToolExecutor(
      new WorkspaceGuard(root),
      async () => {
        wasAskedForApproval = true;
        return true;
      },
      {},
    );
    const result = await executor.execute({ id: "1", name: "generate_3d_model", arguments: { prompt: "gargoyle" } }, "build");
    expect(wasAskedForApproval).toBe(true);
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/No text-to-3D provider configured/);
  });

  it("allows git_status (a read-only git tool) without approval, even in ask mode", async () => {
    const root = await makeProject();
    let approvalCalled = false;
    const executor = new ToolExecutor(new WorkspaceGuard(root), async () => {
      approvalCalled = true;
      return true;
    });
    const result = await executor.execute({ id: "1", name: "git_status", arguments: {} }, "ask");
    expect(approvalCalled).toBe(false);
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content).isRepo).toBe(false);
  });

  it("denies git_commit (a mutating git tool) in ask mode and requires approval in assist mode", async () => {
    const root = await makeProject();
    const denyingExecutor = new ToolExecutor(new WorkspaceGuard(root), async () => true);
    const denied = await denyingExecutor.execute({ id: "1", name: "git_commit", arguments: { message: "x" } }, "ask");
    expect(denied.isError).toBe(true);
    expect(denied.content).toMatch(/not permitted/);

    let wasAskedForApproval = false;
    const assistExecutor = new ToolExecutor(new WorkspaceGuard(root), async () => {
      wasAskedForApproval = true;
      return true;
    });
    // Not a git repo, so the commit itself fails, but approval must still be requested first.
    const result = await assistExecutor.execute({ id: "1", name: "git_commit", arguments: { message: "x" } }, "assist");
    expect(wasAskedForApproval).toBe(true);
    expect(result.isError).toBe(true);
  });

  it("allows inspect_scene (a read-only engine tool) without approval, even in ask mode, and reports missing bridge clearly", async () => {
    const root = await makeProject();
    let approvalCalled = false;
    const executor = new ToolExecutor(new WorkspaceGuard(root), async () => {
      approvalCalled = true;
      return true;
    });
    const result = await executor.execute({ id: "1", name: "inspect_scene", arguments: {} }, "ask");
    expect(approvalCalled).toBe(false);
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/No engine bridge configured/);
  });

  it("denies create_object (a mutating engine tool) in ask mode and requires approval in assist mode", async () => {
    const root = await makeProject();
    const denyingExecutor = new ToolExecutor(new WorkspaceGuard(root), async () => true);
    const denied = await denyingExecutor.execute({ id: "1", name: "create_object", arguments: { name: "Cube" } }, "ask");
    expect(denied.isError).toBe(true);
    expect(denied.content).toMatch(/not permitted/);

    let wasAskedForApproval = false;
    const assistExecutor = new ToolExecutor(new WorkspaceGuard(root), async () => {
      wasAskedForApproval = true;
      return true;
    });
    const result = await assistExecutor.execute({ id: "1", name: "create_object", arguments: { name: "Cube" } }, "assist");
    expect(wasAskedForApproval).toBe(true);
    expect(result.isError).toBe(true); // no bridge configured, but approval was still requested first
  });

  it("dispatches an engine tool call to a configured EngineBridge", async () => {
    const root = await makeProject();
    const fakeBridge = {
      id: "fake",
      displayName: "Fake",
      connect: async () => {},
      disconnect: async () => {},
      isConnected: () => true,
      inspectScene: async () => ({ name: "Scene", objects: [] }),
      inspectObject: async () => {
        throw new Error("not used");
      },
      createObject: async () => ({ path: "/X", name: "X", active: true }),
      modifyObject: async () => {},
      modifyTransform: async () => {},
      modifyComponent: async () => {},
      saveScene: async () => {},
      enterPlayMode: async () => {},
      exitPlayMode: async () => {},
      buildProject: async () => ({ success: true }),
      captureScreenshot: async () => ({ base64Png: "abc" }),
      readConsole: async () => [],
    };
    const executor = new ToolExecutor(new WorkspaceGuard(root), async () => true, {}, fakeBridge as any);
    const result = await executor.execute({ id: "1", name: "inspect_scene", arguments: {} }, "ask");
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content).name).toBe("Scene");
  });

  it("getAvailableTools() excludes engine tools with no bridge and includes them once one is configured", async () => {
    const root = await makeProject();
    const withoutBridge = new ToolExecutor(new WorkspaceGuard(root), async () => true);
    expect(withoutBridge.getAvailableTools().some((t) => t.name === "inspect_scene")).toBe(false);

    const withBridge = new ToolExecutor(new WorkspaceGuard(root), async () => true, {}, { isConnected: () => true } as any);
    expect(withBridge.getAvailableTools().some((t) => t.name === "inspect_scene")).toBe(true);
  });

  it("set_plan/set_requirements/update_requirement_status record real state on the executor's TaskPlanTracker, always allowed even in ask mode", async () => {
    const root = await makeProject();
    const executor = new ToolExecutor(new WorkspaceGuard(root), async () => true);

    const planResult = await executor.execute({ id: "1", name: "set_plan", arguments: { steps: ["read the file", "edit it"] } }, "ask");
    expect(planResult.isError).toBeFalsy();
    expect(executor.getTaskPlanTracker().snapshot().plan).toEqual(["read the file", "edit it"]);

    const reqResult = await executor.execute(
      { id: "2", name: "set_requirements", arguments: { requirements: ["stamina drains on sprint", "stamina bar is visible"] } },
      "ask",
    );
    expect(reqResult.isError).toBeFalsy();
    const requirements = JSON.parse(reqResult.content);
    expect(requirements).toEqual([
      { id: 1, description: "stamina drains on sprint", status: "pending" },
      { id: 2, description: "stamina bar is visible", status: "pending" },
    ]);

    const updateResult = await executor.execute(
      { id: "3", name: "update_requirement_status", arguments: { id: 1, status: "met", note: "confirmed in play mode" } },
      "ask",
    );
    expect(updateResult.isError).toBeFalsy();
    expect(JSON.parse(updateResult.content)).toEqual({ id: 1, description: "stamina drains on sprint", status: "met", note: "confirmed in play mode" });

    const snapshot = executor.getTaskPlanTracker().snapshot();
    expect(snapshot.requirements[0].status).toBe("met");
    expect(snapshot.requirements[1].status).toBe("pending");
  });

  it("update_requirement_status reports a clear error for an unknown id instead of throwing uncaught", async () => {
    const root = await makeProject();
    const executor = new ToolExecutor(new WorkspaceGuard(root), async () => true);
    const result = await executor.execute({ id: "1", name: "update_requirement_status", arguments: { id: 99, status: "met" } }, "ask");
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/No requirement with id 99/);
  });

  it("set_requirements replaces rather than appends on a second call", async () => {
    const root = await makeProject();
    const executor = new ToolExecutor(new WorkspaceGuard(root), async () => true);
    await executor.execute({ id: "1", name: "set_requirements", arguments: { requirements: ["a", "b"] } }, "ask");
    await executor.execute({ id: "2", name: "set_requirements", arguments: { requirements: ["c"] } }, "ask");
    expect(executor.getTaskPlanTracker().snapshot().requirements.map((r) => r.description)).toEqual(["c"]);
  });

  it("inspect_dependencies reports real dependents/dependencies from the actual file graph, always allowed even in ask mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "gf-exec-deps-"));
    await writeFile(join(root, "main.ts"), `import { helper } from "./helper.js";\n`);
    await writeFile(join(root, "helper.ts"), `export function helper() {}\n`);
    const executor = new ToolExecutor(new WorkspaceGuard(root), async () => true);

    const result = await executor.execute({ id: "1", name: "inspect_dependencies", arguments: { path: "helper.ts" } }, "ask");

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content)).toEqual({ dependsOn: [], dependedOnBy: ["main.ts"] });
  });

  it("inspect_dependencies normalizes a leading './' the model might pass", async () => {
    const root = await mkdtemp(join(tmpdir(), "gf-exec-deps-"));
    await writeFile(join(root, "main.ts"), `import { helper } from "./helper.js";\n`);
    await writeFile(join(root, "helper.ts"), `export function helper() {}\n`);
    const executor = new ToolExecutor(new WorkspaceGuard(root), async () => true);

    const result = await executor.execute({ id: "1", name: "inspect_dependencies", arguments: { path: "./main.ts" } }, "ask");

    expect(JSON.parse(result.content)).toEqual({ dependsOn: ["helper.ts"], dependedOnBy: [] });
  });
});
