import { spawn } from "node:child_process";
import type { WorkspaceGuard } from "./workspace.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;

export interface RunCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

/** Environment variables never passed through to spawned commands. */
const BLOCKED_ENV_PATTERNS = [/API_KEY/i, /SECRET/i, /TOKEN/i, /PASSWORD/i, /_CREDENTIALS/i];

function sanitizedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (BLOCKED_ENV_PATTERNS.some((p) => p.test(key))) continue;
    env[key] = value;
  }
  return env;
}

export async function runCommandTool(
  guard: WorkspaceGuard,
  command: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<RunCommandResult> {
  const effectiveTimeout = Math.min(timeoutMs, MAX_TIMEOUT_MS);

  return new Promise((resolvePromise) => {
    // `detached: true` puts the child in its own process group so it can be
    // killed as a group below. Without this, a shell that *forks* a
    // grandchild rather than exec-replacing itself (which real shells don't
    // always do, even for what looks like a single simple command) leaves
    // that grandchild alive after `child.kill()` — it keeps holding the
    // inherited stdout/stderr pipe open, so the `close` event this promise
    // waits on never fires and the call hangs past its own timeout. Found by
    // writing a real "does abort actually kill a sleeping command" test and
    // watching it hang, not by inspection.
    const child = spawn(command, {
      shell: true,
      cwd: guard.root,
      env: sanitizedEnv(),
      detached: process.platform !== "win32",
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    // Windows has no POSIX process groups, so `-pid` isn't available — but
    // `shell: true` there spawns cmd.exe as the immediate child, and cmd.exe
    // execs the real command as its *own* child rather than replacing itself.
    // Killing only cmd.exe leaves that grandchild alive, still holding the
    // inherited stdout/stderr handles open, so `close` never fires and the
    // call hangs past its own timeout — the same failure mode as the POSIX
    // case above. `taskkill /t` kills the whole tree rooted at cmd.exe's pid.
    // Confirmed live on Windows: `child.kill()` alone leaves the grandchild
    // running and `close` never fires; `taskkill /t /f` fixes it.
    const killTree = () => {
      if (process.platform === "win32") {
        if (child.pid) {
          spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"]).on("error", () => {
            child.kill("SIGKILL");
          });
        } else {
          child.kill("SIGKILL");
        }
        return;
      }
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
          return;
        } catch {
          // Group may already be gone, or this platform doesn't support it — fall through.
        }
      }
      child.kill("SIGKILL");
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killTree();
    }, effectiveTimeout);

    // A cancelled agent run shouldn't leave a shell command running in the
    // background until its own (up to 120s) timeout finally kills it —
    // abort should stop it immediately, the same way it stops everything
    // else in that run.
    const onAbort = () => killTree();
    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolvePromise({ stdout: stdout.slice(0, 50_000), stderr: stderr.slice(0, 50_000), exitCode: code, timedOut });
    });
  });
}
