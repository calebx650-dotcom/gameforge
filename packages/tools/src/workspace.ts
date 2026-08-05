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

  /** Like resolve(), but also follows symlinks to catch escapes via links. */
  async resolveReal(inputPath: string): Promise<string> {
    const target = this.resolve(inputPath);
    try {
      const real = await realpath(target);
      const normalizedRoot = this.root.endsWith(sep) ? this.root : this.root + sep;
      if (real !== this.root && !real.startsWith(normalizedRoot)) {
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
