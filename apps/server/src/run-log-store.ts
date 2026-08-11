import { appendFile, mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { OperationLogEntry } from "@gameforge/shared";

/**
 * Persists the `OperationLogEntry` stream for each agent run to disk — the
 * P4 "the operation log is in-memory per agent run only" gap. One JSONL
 * file per run under `.gameforge/logs/<runId>.jsonl`, appended to as
 * entries arrive (via `Agent`'s `onLogEntry` callback in
 * `chat-socket.ts`), not written once at the end — a crash mid-run still
 * leaves every entry recorded up to that point readable, since each line
 * is a complete, independent JSON value.
 */
export class RunLogStore {
  constructor(private readonly logsDir: string) {}

  private async ensureDir(): Promise<void> {
    await mkdir(this.logsDir, { recursive: true });
  }

  private logPath(runId: string): string {
    return join(this.logsDir, `${runId}.jsonl`);
  }

  async append(runId: string, entry: OperationLogEntry): Promise<void> {
    await this.ensureDir();
    await appendFile(this.logPath(runId), `${JSON.stringify(entry)}\n`, "utf-8");
  }

  /** Every entry recorded for one run, in the order they were appended. */
  async readRun(runId: string): Promise<OperationLogEntry[]> {
    const content = await readFile(this.logPath(runId), "utf-8").catch(() => "");
    return content
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as OperationLogEntry);
  }

  /** Run ids that have at least one persisted log entry, lexicographically sorted — chronological order if the caller's run ids are timestamp-prefixed (see `chat-socket.ts`'s `generateRunId()`). */
  async listRuns(): Promise<string[]> {
    const files = await readdir(this.logsDir).catch(() => [] as string[]);
    return files
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => f.slice(0, -".jsonl".length))
      .sort();
  }
}
