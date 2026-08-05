import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceGuard, WorkspaceViolationError } from "./workspace.js";

describe("WorkspaceGuard", () => {
  it("resolves paths inside the root", async () => {
    const root = await mkdtemp(join(tmpdir(), "gf-ws-"));
    const guard = new WorkspaceGuard(root);
    expect(guard.resolve("src/index.ts")).toBe(join(root, "src/index.ts"));
  });

  it("rejects .. traversal outside the root", async () => {
    const root = await mkdtemp(join(tmpdir(), "gf-ws-"));
    const guard = new WorkspaceGuard(root);
    expect(() => guard.resolve("../../etc/passwd")).toThrow(WorkspaceViolationError);
  });

  it("rejects absolute paths outside the root", async () => {
    const root = await mkdtemp(join(tmpdir(), "gf-ws-"));
    const guard = new WorkspaceGuard(root);
    expect(() => guard.resolve("/etc/passwd")).toThrow(WorkspaceViolationError);
  });
});
