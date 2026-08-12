import { resolve, sep } from "node:path";
import { realpath } from "node:fs/promises";

export class WorkspaceViolationError extends Error {
  constructor(path: string) {
    super(`Path escapes workspace root: ${path}`);
    this.name = "WorkspaceViolationError";
  }
}

/**
 * Confines every filesystem tool to a single project root. This is the one
 * gate all read/write tools must pass through — nothing in this package
 * should touch node:fs directly without going through here first.
 */
export class WorkspaceGuard {
  constructor(public readonly root: string) {}

  /** Resolve a (possibly relative) path and verify it stays inside the root. */
  resolve(inputPath: string): string {
    const target = resolve(this.root, inputPath);
    const normalizedRoot = this.root.endsWith(sep) ? this.root : this.root + sep;
    if (target !== this.root && !target.startsWith(normalizedRoot)) {
      throw new WorkspaceViolationError(inputPath);
    }
    return target;
  }

  /**
   * Like resolve(), but also follows symlinks to catch escapes via links.
   *
   * Real bug fixed 2026-08-10: this used to compare `realpath(target)`
   * (which resolves to the OS's canonical long-form path) directly against
   * the raw `this.root` string. On Windows, a project root under a
   * short-name-aliased path component (`os.tmpdir()` commonly returns
   * `C:\Users\CALEBH~1\...` rather than `C:\Users\Caleb haynes\...` — the
   * same 8.3-alias mismatch fixed in `git-tools.ts`'s `isGitRepo`) meant
   * `real` could never equal or start with `this.root`, so every existing
   * file failed with `WorkspaceViolationError: Path escapes workspace
   * root`, even for a plain read of a file that was obviously inside the
   * project (confirmed live 2026-08-10: `read_file`/`edit_file` on a
   * project opened from a tmpdir-based path both failed this way). Both
   * sides are now realpath'd before comparing, so short-name aliasing
   * (and symlinks in the root itself) don't produce a false escape.
   */
  async resolveReal(inputPath: string): Promise<string> {
    const target = this.resolve(inputPath);
    const realRoot = await realpath(this.root).catch(() => this.root);
    const normalizedRealRoot = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
    try {
      const real = await realpath(target);
      if (real !== realRoot && !real.startsWith(normalizedRealRoot)) {
        throw new WorkspaceViolationError(inputPath);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      // Path doesn't exist yet (e.g. a file about to be created) — the
      // pre-symlink check above already guarantees it's within root.
    }
    return target;
  }
}
