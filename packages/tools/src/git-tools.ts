import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";
import type { AgentMode } from "@gameforge/shared";
import type { WorkspaceGuard } from "./workspace.js";

const execFileAsync = promisify(execFile);

async function git(guard: WorkspaceGuard, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd: guard.root, maxBuffer: 10 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr;
    throw new Error(`git ${args[0]} failed: ${stderr?.trim() || (err as Error).message}`);
  }
}

/**
 * True only when `guard.root` is itself the top of a git work tree — not merely nested
 * somewhere inside an unrelated ancestor repo. The previous check
 * (`git rev-parse --is-inside-work-tree`) answers a different question: it's true for ANY
 * directory under ANY ancestor `.git`, no matter how far up, so it can't distinguish "this
 * project is a real git repo" from "this project happens to sit inside someone else's real
 * git repo." Confirmed live 2026-08-11: on a machine where `os.tmpdir()` resolves under the
 * user's home directory, and that home directory is itself the working tree of a real,
 * unrelated personal project's git repo, every plain (non-git) scratch/test directory under
 * the temp dir was misreported as "yes, a git repo" — and `maybeCreateCheckpoint` /
 * `restoreCheckpoint` then ran real `git add`/`commit`/`reset --hard` against that ancestor
 * repo. `reset --hard` in particular resets the *entire* discovered work tree, not just the
 * project subdirectory, so this was a real path to destructively wiping out uncommitted
 * work in a repository GameForge was never told about, not just a misattributed commit.
 * Comparing the repo's real toplevel against guard.root (both realpath'd, the same way
 * `WorkspaceGuard.resolveReal` already has to for Windows 8.3 short-name aliasing) closes
 * that gap: a project that is a subdirectory of a larger repo is — correctly, if
 * conservatively — treated as "not a git repo" for GameForge's own checkpoint/restore
 * purposes, rather than risking those operations against a repo boundary the user never
 * pointed GameForge at.
 */
async function isGitRepo(guard: WorkspaceGuard): Promise<boolean> {
  try {
    const toplevel = (await git(guard, ["rev-parse", "--show-toplevel"])).trim();
    const [realToplevel, realRoot] = await Promise.all([
      realpath(toplevel).catch(() => toplevel),
      realpath(guard.root).catch(() => guard.root),
    ]);
    return normalizePathForComparison(realToplevel) === normalizePathForComparison(realRoot);
  } catch {
    return false;
  }
}

function normalizePathForComparison(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export interface GitStatusResult {
  isRepo: boolean;
  branch?: string;
  staged: string[];
  unstaged: string[];
  untracked: string[];
}

export async function gitStatusTool(guard: WorkspaceGuard): Promise<GitStatusResult> {
  if (!(await isGitRepo(guard))) {
    return { isRepo: false, staged: [], unstaged: [], untracked: [] };
  }
  const [branchOut, statusOut] = await Promise.all([
    git(guard, ["symbolic-ref", "--short", "HEAD"]).catch(() => "HEAD"),
    git(guard, ["status", "--porcelain"]),
  ]);

  const staged: string[] = [];
  const unstaged: string[] = [];
  const untracked: string[] = [];
  for (const line of statusOut.split("\n")) {
    if (!line.trim()) continue;
    const indexState = line[0];
    const worktreeState = line[1];
    const path = line.slice(3);
    if (indexState === "?" && worktreeState === "?") untracked.push(path);
    else {
      if (indexState !== " " && indexState !== "?") staged.push(path);
      if (worktreeState !== " " && worktreeState !== "?") unstaged.push(path);
    }
  }

  return { isRepo: true, branch: branchOut.trim(), staged, unstaged, untracked };
}

export async function gitDiffTool(guard: WorkspaceGuard, path?: string): Promise<string> {
  const args = ["diff", "--no-color"];
  if (path) args.push("--", path);
  return git(guard, args);
}

export interface GitLogEntry {
  hash: string;
  author: string;
  date: string;
  message: string;
}

export async function gitLogTool(guard: WorkspaceGuard, limit = 20): Promise<GitLogEntry[]> {
  const format = "%H%x1f%an%x1f%aI%x1f%s%x1e";
  let out: string;
  try {
    out = await git(guard, ["log", `--max-count=${limit}`, `--pretty=format:${format}`]);
  } catch {
    return []; // no commits yet
  }
  return out
    .split("\x1e")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [hash, author, date, message] = entry.split("\x1f");
      return { hash, author, date, message };
    });
}

export interface GitBranchResult {
  current: string;
  branches: string[];
}

export async function gitBranchTool(guard: WorkspaceGuard): Promise<GitBranchResult> {
  const out = await git(guard, ["branch", "--list"]);
  const branches = out
    .split("\n")
    .map((line) => line.replace(/^\*?\s*/, "").trim())
    .filter(Boolean);
  const currentLine = out.split("\n").find((line) => line.startsWith("*"));
  const current = currentLine ? currentLine.replace(/^\*\s*/, "").trim() : "";
  return { current, branches };
}

export interface GitCommitResult {
  hash: string;
  message: string;
}

export async function gitCommitTool(guard: WorkspaceGuard, message: string, paths?: string[]): Promise<GitCommitResult> {
  if (paths?.length) {
    await git(guard, ["add", "--", ...paths]);
  } else {
    await git(guard, ["add", "-A"]);
  }
  await git(guard, ["commit", "-m", message]);
  const hash = (await git(guard, ["rev-parse", "HEAD"])).trim();
  return { hash, message };
}

export class InvalidCommitReferenceError extends Error {
  constructor(hash: string) {
    super(`"${hash}" does not look like a valid commit reference in this repository.`);
    this.name = "InvalidCommitReferenceError";
  }
}

/**
 * Hard-resets the working tree to a given commit — a genuinely
 * destructive operation (uncommitted changes since that commit are
 * lost), so this is deliberately NOT exposed as an agent tool through
 * `ToolExecutor`/`GENERATION_TOOL_NAMES` or anywhere the model can reach
 * it. It exists only for a direct, explicit user action (e.g. a "Restore
 * checkpoint" button in the UI) — see apps/server's git REST routes.
 * Validates the hash looks like a real commit reference before running
 * `reset --hard`, both to catch typos and to avoid passing arbitrary
 * unvalidated input to git (even though `execFile` already prevents shell
 * injection, a bad hash silently resetting to the wrong commit is its own
 * failure mode worth guarding against).
 */
export async function restoreCheckpoint(guard: WorkspaceGuard, hash: string): Promise<{ restoredTo: string }> {
  if (!/^[0-9a-f]{7,40}$/i.test(hash)) {
    throw new InvalidCommitReferenceError(hash);
  }
  try {
    await git(guard, ["cat-file", "-e", `${hash}^{commit}`]);
  } catch {
    throw new InvalidCommitReferenceError(hash);
  }
  await git(guard, ["reset", "--hard", hash]);
  return { restoredTo: hash };
}

export interface CheckpointResult {
  created: boolean;
  hash?: string;
  reason: string;
}

/**
 * Auto-commits the current dirty working tree as a checkpoint before an
 * agent run that's allowed to modify the project (build/autonomous mode),
 * so a bad run always has a `git reset --hard <hash>` / revert path back
 * to a known-good state, without the user having to remember to commit
 * first. No-ops (does not create an empty commit) if the tree is already
 * clean, the project isn't a git repo, or the mode wouldn't allow mutation
 * anyway.
 */
export async function maybeCreateCheckpoint(guard: WorkspaceGuard, mode: AgentMode, label: string): Promise<CheckpointResult> {
  if (mode !== "build" && mode !== "autonomous") {
    return { created: false, reason: `Checkpoints are only created in build/autonomous mode (current mode: ${mode}).` };
  }
  if (!(await isGitRepo(guard))) {
    return { created: false, reason: "Project is not a git repository." };
  }
  const status = await gitStatusTool(guard);
  if (status.staged.length === 0 && status.unstaged.length === 0 && status.untracked.length === 0) {
    return { created: false, reason: "Working tree is already clean." };
  }
  const result = await gitCommitTool(guard, `GameForge checkpoint: ${label}`);
  return { created: true, hash: result.hash, reason: "Checkpoint created." };
}
