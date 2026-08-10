import type { OperationLogEntry, ToolCall, ToolResultMessage } from "@gameforge/shared";

const MUTATING_FILE_TOOLS = new Set(["create_file", "edit_file", "delete_file"]);

export interface BuildAttempt {
  attempt: number;
  status: "building" | "success" | "failed";
  errors?: string[];
}

export interface FileChange {
  tool: string;
  path: string;
}

/**
 * Everything here is derived client-side from the same OperationLogEntry
 * stream the Tool Activity panel already renders — no server changes, since
 * tool_call/tool_result entries already carry the real ToolCall/ToolResult
 * as `detail` (see packages/agent/src/agent.ts's executeAndRecord). "Fixing"
 * is inferred by the caller, not reported explicitly here: a file edit that
 * lands between a failed build_project and the next one.
 */
export function deriveBuildAttempts(log: OperationLogEntry[]): BuildAttempt[] {
  const attempts: BuildAttempt[] = [];
  for (const entry of log) {
    if (entry.kind === "tool_call" && (entry.detail as ToolCall)?.name === "build_project") {
      attempts.push({ attempt: attempts.length + 1, status: "building" });
      continue;
    }
    const last = attempts[attempts.length - 1];
    if (!last || last.status !== "building") continue;
    if (entry.kind !== "tool_result" && entry.kind !== "error") continue;

    const content = (entry.detail as ToolResultMessage | undefined)?.content;
    let parsedSuccess: boolean | undefined;
    let parsedErrors: string[] | undefined;
    if (content) {
      try {
        const parsed = JSON.parse(content);
        if (typeof parsed.success === "boolean") parsedSuccess = parsed.success;
        if (Array.isArray(parsed.errors)) parsedErrors = parsed.errors;
      } catch {
        // build_project's ToolResult content is always this JSON shape on
        // success; a non-JSON error string still falls through to the
        // entry.kind check below.
      }
    }
    last.status = parsedSuccess !== undefined ? (parsedSuccess ? "success" : "failed") : entry.kind === "error" ? "failed" : "success";
    if (parsedErrors) last.errors = parsedErrors;
  }
  return attempts;
}

export function deriveFilesChanged(log: OperationLogEntry[]): FileChange[] {
  const changes: FileChange[] = [];
  for (const entry of log) {
    if (entry.kind !== "tool_call") continue;
    const call = entry.detail as ToolCall | undefined;
    if (!call || !MUTATING_FILE_TOOLS.has(call.name)) continue;
    const path = (call.arguments as { path?: string })?.path;
    if (path) changes.push({ tool: call.name, path });
  }
  return changes;
}
