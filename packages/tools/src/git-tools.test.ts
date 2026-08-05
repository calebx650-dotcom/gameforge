import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { WorkspaceGuard } from "./workspace.js";
import {
  gitStatusTool,
  gitDiffTool,
  gitLogTool,
  gitBranchTool,
  gitCommitTool,
  maybeCreateCheckpoint,
  restoreCheckpoint,
  InvalidCommitReferenceError,
} from "./git-tools.js";

const execFileAsync = promisify(execFile);

async function makeRepo(): Promise<WorkspaceGuard> {
  const root = await mkdtemp(join(tmpdir(), "gf-git-"));
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Test"], { cwd: root });
  return new WorkspaceGuard(root);
}

describe("gitStatusTool", () => {
  it("reports isRepo: false for a plain directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "gf-noRepo-"));
    const status = await gitStatusTool(new WorkspaceGuard(root));
    expect(status.isRepo).toBe(false);
  });

  it("reports untracked, unstaged, and staged files distinctly", async () => {
    const guard = await makeRepo();
    await writeFile(join(guard.root, "committed.txt"), "v1\n");
    await execFileAsync("git", ["add", "-A"], { cwd: guard.root });
    await execFileAsync("git", ["commit", "-m", "initial"], { cwd: guard.root });

    await writeFile(join(guard.root, "committed.txt"), "v2\n"); // unstaged modification
    await writeFile(join(guard.root, "new.txt"), "new\n"); // untracked
    await execFileAsync("git", ["add", "new.txt"], { cwd: guard.root }); // now staged

    const status = await gitStatusTool(guard);
    expect(status.isRepo).toBe(true);
    expect(status.unstaged).toContain("committed.txt");
    expect(status.staged).toContain("new.txt");
  });
});

describe("gitDiffTool", () => {
  it("shows the unstaged diff for a modified file", async () => {
    const guard = await makeRepo();
    await writeFile(join(guard.root, "a.txt"), "hello\n");
    await execFileAsync("git", ["add", "-A"], { cwd: guard.root });
    await execFileAsync("git", ["commit", "-m", "initial"], { cwd: guard.root });
    await writeFile(join(guard.root, "a.txt"), "goodbye\n");

    const diff = await gitDiffTool(guard);
    expect(diff).toContain("-hello");
    expect(diff).toContain("+goodbye");
  });
});

describe("gitLogTool", () => {
  it("returns an empty array for a repo with no commits yet", async () => {
    const guard = await makeRepo();
    expect(await gitLogTool(guard)).toEqual([]);
  });

  it("returns recent commits with hash/author/date/message", async () => {
    const guard = await makeRepo();
    await writeFile(join(guard.root, "a.txt"), "1\n");
    await execFileAsync("git", ["add", "-A"], { cwd: guard.root });
    await execFileAsync("git", ["commit", "-m", "first commit"], { cwd: guard.root });

    const log = await gitLogTool(guard, 5);
    expect(log).toHaveLength(1);
    expect(log[0].message).toBe("first commit");
    expect(log[0].hash).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("gitBranchTool", () => {
  it("reports the current branch", async () => {
    const guard = await makeRepo();
    await writeFile(join(guard.root, "a.txt"), "1\n");
    await execFileAsync("git", ["add", "-A"], { cwd: guard.root });
    await execFileAsync("git", ["commit", "-m", "first"], { cwd: guard.root });

    const result = await gitBranchTool(guard);
    expect(result.branches).toContain(result.current);
  });
});

describe("gitCommitTool", () => {
  it("stages all changes and commits when no paths are given", async () => {
    const guard = await makeRepo();
    await writeFile(join(guard.root, "a.txt"), "1\n");
    await writeFile(join(guard.root, "b.txt"), "2\n");

    const result = await gitCommitTool(guard, "add a and b");
    expect(result.message).toBe("add a and b");
    expect(result.hash).toMatch(/^[0-9a-f]{40}$/);

    const status = await gitStatusTool(guard);
    expect(status.staged).toEqual([]);
    expect(status.unstaged).toEqual([]);
    expect(status.untracked).toEqual([]);
  });

  it("stages only the given paths when specified", async () => {
    const guard = await makeRepo();
    await writeFile(join(guard.root, "a.txt"), "1\n");
    await writeFile(join(guard.root, "b.txt"), "2\n");

    await gitCommitTool(guard, "add only a", ["a.txt"]);

    const status = await gitStatusTool(guard);
    expect(status.untracked).toContain("b.txt");
  });
});

describe("maybeCreateCheckpoint", () => {
  it("does not create a checkpoint in ask or assist mode", async () => {
    const guard = await makeRepo();
    await writeFile(join(guard.root, "a.txt"), "1\n");
    const askResult = await maybeCreateCheckpoint(guard, "ask", "test");
    expect(askResult.created).toBe(false);
    const assistResult = await maybeCreateCheckpoint(guard, "assist", "test");
    expect(assistResult.created).toBe(false);
  });

  it("does not create a checkpoint when the working tree is already clean", async () => {
    const guard = await makeRepo();
    await writeFile(join(guard.root, "a.txt"), "1\n");
    await execFileAsync("git", ["add", "-A"], { cwd: guard.root });
    await execFileAsync("git", ["commit", "-m", "initial"], { cwd: guard.root });

    const result = await maybeCreateCheckpoint(guard, "build", "test");
    expect(result.created).toBe(false);
    expect(result.reason).toMatch(/already clean/);
  });

  it("does not create a checkpoint outside a git repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "gf-noRepo2-"));
    const result = await maybeCreateCheckpoint(new WorkspaceGuard(root), "autonomous", "test");
    expect(result.created).toBe(false);
    expect(result.reason).toMatch(/not a git repository/);
  });

  it("creates a checkpoint commit in build/autonomous mode when the tree is dirty", async () => {
    const guard = await makeRepo();
    await writeFile(join(guard.root, "a.txt"), "1\n");
    await execFileAsync("git", ["add", "-A"], { cwd: guard.root });
    await execFileAsync("git", ["commit", "-m", "initial"], { cwd: guard.root });

    await writeFile(join(guard.root, "a.txt"), "2\n"); // dirty it

    const result = await maybeCreateCheckpoint(guard, "autonomous", "before risky change");
    expect(result.created).toBe(true);
    expect(result.hash).toMatch(/^[0-9a-f]{40}$/);

    const log = await gitLogTool(guard, 1);
    expect(log[0].message).toBe("GameForge checkpoint: before risky change");

    const status = await gitStatusTool(guard);
    expect(status.unstaged).toEqual([]); // checkpoint committed the dirty file
  });
});

describe("restoreCheckpoint", () => {
  it("hard-resets the working tree to the given commit", async () => {
    const guard = await makeRepo();
    await writeFile(join(guard.root, "a.txt"), "v1\n");
    await execFileAsync("git", ["add", "-A"], { cwd: guard.root });
    await execFileAsync("git", ["commit", "-m", "v1"], { cwd: guard.root });
    const checkpointHash = (await gitLogTool(guard, 1))[0].hash;

    await writeFile(join(guard.root, "a.txt"), "v2 - a change we want to discard\n");
    await execFileAsync("git", ["add", "-A"], { cwd: guard.root });
    await execFileAsync("git", ["commit", "-m", "v2"], { cwd: guard.root });

    const result = await restoreCheckpoint(guard, checkpointHash);
    expect(result.restoredTo).toBe(checkpointHash);

    const content = await readFile(join(guard.root, "a.txt"), "utf-8");
    expect(content).toBe("v1\n");
  });

  it("rejects a malformed commit reference without touching the repo", async () => {
    const guard = await makeRepo();
    await expect(restoreCheckpoint(guard, "not a hash; rm -rf /")).rejects.toThrow(InvalidCommitReferenceError);
  });

  it("rejects a well-formed but nonexistent commit hash", async () => {
    const guard = await makeRepo();
    await writeFile(join(guard.root, "a.txt"), "1\n");
    await execFileAsync("git", ["add", "-A"], { cwd: guard.root });
    await execFileAsync("git", ["commit", "-m", "initial"], { cwd: guard.root });

    await expect(restoreCheckpoint(guard, "abc1234")).rejects.toThrow(InvalidCommitReferenceError);
  });
});
