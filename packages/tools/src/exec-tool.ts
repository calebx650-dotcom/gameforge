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
): Promise<RunCommandResult> {
  const effectiveTimeout = Math.min(timeoutMs, MAX_TIMEOUT_MS);

  return new Promise((resolvePromise) => {
    const child = spawn(command, {
      shell: true,
      cwd: guard.root,
      env: sanitizedEnv(),
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, effectiveTimeout);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ stdout: stdout.slice(0, 50_000), stderr: stderr.slice(0, 50_000), exitCode: code, timedOut });
    });
  });
}
