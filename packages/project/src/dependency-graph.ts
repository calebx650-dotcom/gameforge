import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "build", "Library", "Temp", "obj", "bin", ".gameforge"]);
const RESOLVABLE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

export interface DependencyGraphEntry {
  /** Path relative to the project root, forward-slash separated. */
  file: string;
  /** Other project files (relative paths) this file imports — external package imports are not included, since they aren't part of the project's own file graph. */
  imports: string[];
}

export interface DependencyGraph {
  entries: DependencyGraphEntry[];
}

/**
 * A real file-level import graph — **TypeScript/JavaScript only**. This is
 * a deliberate scope limit, not an oversight: a TS/JS `import` statement
 * names a real relative file path, so "what does this file import" is a
 * question this can answer exactly by resolving that path on disk. C#'s
 * `using` statements name *namespaces*, not files — resolving "which file
 * defines this namespace" needs real symbol resolution (or at minimum a
 * project-wide type index), which this file-path-based approach can't do
 * honestly. Building a graph from `using` statements and presenting it as
 * equivalent would be exactly the kind of "looks like it works but doesn't"
 * result this codebase's testing discipline exists to avoid — so a
 * non-JS/TS project just gets an empty graph back, not a fabricated one.
 */
async function collectSourceFiles(root: string, dir: string, out: string[], depth: number): Promise<void> {
  if (depth > 8) return;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectSourceFiles(root, full, out, depth + 1);
    } else if (RESOLVABLE_EXTENSIONS.some((ext) => entry.name.endsWith(ext)) && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
}

/** Matches `import ... from "..."`, `export ... from "..."`, and `require("...")` specifiers — the three ways a TS/JS file names another module. */
const IMPORT_SPECIFIER_PATTERN = /(?:import|export)(?:[^'"]*?)from\s*['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g;

function extractImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(IMPORT_SPECIFIER_PATTERN)) {
    const specifier = match[1] ?? match[2];
    if (specifier) specifiers.push(specifier);
  }
  return specifiers;
}

/** Strips a trailing resolvable extension, if present, so both an extensionless specifier and one already ending in e.g. ".js" can be tried against every real extension — TS ESM output routinely imports "./helper.js" for a file that's actually helper.ts on disk. */
function withoutKnownExtension(path: string): string {
  const ext = RESOLVABLE_EXTENSIONS.find((e) => path.endsWith(e));
  return ext ? path.slice(0, -ext.length) : path;
}

/** Resolves a relative import specifier to a real file on disk, trying the usual extension/index-file fallbacks — undefined if nothing on disk matches (a non-relative/external package import, or a path that doesn't actually exist). */
async function resolveSpecifier(fromFile: string, specifier: string): Promise<string | undefined> {
  if (!specifier.startsWith(".")) return undefined; // external package — not part of this project's own graph
  const base = resolve(dirname(fromFile), specifier);
  const baseWithoutExt = withoutKnownExtension(base);
  const candidates = [
    base,
    ...RESOLVABLE_EXTENSIONS.map((ext) => baseWithoutExt + ext),
    ...RESOLVABLE_EXTENSIONS.map((ext) => join(base, `index${ext}`)),
  ];
  for (const candidate of candidates) {
    const isFile = await stat(candidate)
      .then((s) => s.isFile())
      .catch(() => false);
    if (isFile) return candidate;
  }
  return undefined;
}

function toRelative(root: string, absolutePath: string): string {
  return relative(root, absolutePath).split("\\").join("/");
}

export async function buildDependencyGraph(root: string): Promise<DependencyGraph> {
  const files: string[] = [];
  await collectSourceFiles(root, root, files, 0);

  const entries: DependencyGraphEntry[] = [];
  for (const file of files) {
    const source = await readFile(file, "utf-8").catch(() => "");
    const specifiers = extractImportSpecifiers(source);
    const resolvedImports = new Set<string>();
    for (const specifier of specifiers) {
      const resolved = await resolveSpecifier(file, specifier);
      if (resolved) resolvedImports.add(toRelative(root, resolved));
    }
    entries.push({ file: toRelative(root, file), imports: Array.from(resolvedImports).sort() });
  }
  entries.sort((a, b) => a.file.localeCompare(b.file));
  return { entries };
}

/** Other files this one imports, per the graph. */
export function findDependencies(graph: DependencyGraph, file: string): string[] {
  return graph.entries.find((e) => e.file === file)?.imports ?? [];
}

/** Other files that import this one, per the graph — the reverse direction, useful for "what would break if I change this file." */
export function findDependents(graph: DependencyGraph, file: string): string[] {
  return graph.entries.filter((e) => e.imports.includes(file)).map((e) => e.file).sort();
}
