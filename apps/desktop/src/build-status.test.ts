import { describe, expect, it } from "vitest";
import type { OperationLogEntry } from "@gameforge/shared";
import { deriveBuildAttempts, deriveFilesChanged } from "./build-status.js";

/**
 * Log entries shaped exactly like packages/agent/src/agent.ts's
 * executeAndRecord() produces them (see its `record()` calls), mirroring
 * the real create -> build -> fail -> fix -> build -> succeed repair loop
 * apps/server/src/e2e.test.ts drives against a real WebSocket + fake
 * unity-mcp server. This proves the desktop UI's derivation logic reads
 * that real shape correctly, not a shape invented for this test.
 */
function repairLoopLog(): OperationLogEntry[] {
  return [
    {
      timestamp: 1,
      kind: "tool_call",
      summary: 'create_file(path="Assets/Player.cs")',
      detail: { id: "1", name: "create_file", arguments: { path: "Assets/Player.cs", content: "broken" } },
    },
    {
      timestamp: 2,
      kind: "tool_result",
      summary: "create_file succeeded",
      detail: { role: "tool", toolCallId: "1", name: "create_file", content: '{"path":"Assets/Player.cs"}' },
    },
    {
      timestamp: 3,
      kind: "tool_call",
      summary: "build_project()",
      detail: { id: "2", name: "build_project", arguments: {} },
    },
    {
      timestamp: 4,
      kind: "tool_result",
      summary: "build_project succeeded",
      detail: {
        role: "tool",
        toolCallId: "2",
        name: "build_project",
        content: '{"success":false,"errors":["CS1002: ; expected in Player.cs"]}',
      },
    },
    {
      timestamp: 5,
      kind: "tool_call",
      summary: 'edit_file(path="Assets/Player.cs")',
      detail: {
        id: "3",
        name: "edit_file",
        arguments: { path: "Assets/Player.cs", oldText: "broken", newText: "fixed C#" },
      },
    },
    {
      timestamp: 6,
      kind: "tool_result",
      summary: "edit_file succeeded",
      detail: { role: "tool", toolCallId: "3", name: "edit_file", content: '{"path":"Assets/Player.cs"}' },
    },
    {
      timestamp: 7,
      kind: "tool_call",
      summary: "build_project()",
      detail: { id: "4", name: "build_project", arguments: {} },
    },
    {
      timestamp: 8,
      kind: "tool_result",
      summary: "build_project succeeded",
      detail: { role: "tool", toolCallId: "4", name: "build_project", content: '{"success":true}' },
    },
  ];
}

describe("deriveBuildAttempts", () => {
  it("reconstructs the real fail-then-succeed repair loop as two distinct attempts", () => {
    const attempts = deriveBuildAttempts(repairLoopLog());
    expect(attempts).toEqual([
      { attempt: 1, status: "failed", errors: ["CS1002: ; expected in Player.cs"] },
      { attempt: 2, status: "success" },
    ]);
  });

  it("reports the in-flight attempt as building while its tool_result hasn't arrived yet", () => {
    const log = repairLoopLog().slice(0, 3);
    expect(deriveBuildAttempts(log)).toEqual([{ attempt: 1, status: "building" }]);
  });

  it("treats a hard tool error (engine unreachable, no JSON content) as a failed attempt", () => {
    const log: OperationLogEntry[] = [
      { timestamp: 1, kind: "tool_call", summary: "build_project()", detail: { id: "1", name: "build_project", arguments: {} } },
      {
        timestamp: 2,
        kind: "error",
        summary: "build_project failed: connect ECONNREFUSED",
        detail: { role: "tool", toolCallId: "1", name: "build_project", content: "connect ECONNREFUSED", isError: true },
      },
    ];
    expect(deriveBuildAttempts(log)).toEqual([{ attempt: 1, status: "failed" }]);
  });

  it("returns no attempts when the log has no build_project calls", () => {
    expect(deriveBuildAttempts([{ timestamp: 1, kind: "message", summary: "hi" }])).toEqual([]);
  });
});

describe("deriveFilesChanged", () => {
  it("lists the real create/edit calls from the repair loop, in order, with their tool name and path", () => {
    expect(deriveFilesChanged(repairLoopLog())).toEqual([
      { tool: "create_file", path: "Assets/Player.cs" },
      { tool: "edit_file", path: "Assets/Player.cs" },
    ]);
  });

  it("ignores read-only tool calls", () => {
    const log: OperationLogEntry[] = [
      { timestamp: 1, kind: "tool_call", summary: "read_file(...)", detail: { id: "1", name: "read_file", arguments: { path: "x.cs" } } },
    ];
    expect(deriveFilesChanged(log)).toEqual([]);
  });
});
