import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
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

  it("resolveReal accepts an existing file inside the root even when realpath resolves the root to a differently-formed (e.g. short-name-aliased) string", async () => {
    // Reproduced live 2026-08-10: on this real Windows machine, os.tmpdir() itself
    // returns the legacy 8.3 short-name form (C:\Users\CALEBH~1\...), while
    // fs.realpath resolves to the long form (C:\Users\Caleb haynes\...) — the same
    // directory, two different strings. The old code compared realpath(target)
    // against the raw, un-realpath'd `root` and always failed, so every real
    // read_file/edit_file call on a project under such a path threw
    // WorkspaceViolationError even for a plain file that was obviously inside it.
    const root = await mkdtemp(join(tmpdir(), "gf-ws-"));
    await writeFile(join(root, "file.txt"), "hi");
    const guard = new WorkspaceGuard(root);
    await expect(guard.resolveReal("file.txt")).resolves.toBe(join(root, "file.txt"));
  });
});
