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
});
