import { readdir, stat } from "node:fs/promises";
import { join, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "build", "Library", "Temp", "obj", "bin", ".gameforge"]);

export type EngineKind = "unity" | "unreal" | "godot" | "none";

export interface ProjectContext {
  root: string;
  engine: EngineKind;
  languages: string[];
  packageFiles: string[];
  sourceDirectories: string[];
  sceneFiles: string[];
  docFiles: string[];
  git: GitSummary;
}

export interface GitSummary {
  isRepo: boolean;
  branch?: string;
  dirtyFileCount?: number;
}

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  ".cs": "C#",
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".py": "Python",
  ".rs": "Rust",
  ".cpp": "C++",
  ".h": "C++",
  ".java": "Java",
  ".gd": "GDScript",
};

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function detectEngine(root: string): Promise<EngineKind> {
  if (await exists(join(root, "Assets")) && await exists(join(root, "ProjectSettings"))) return "unity";
  if (await exists(join(root, "project.godot"))) return "godot";
  const entries = await readdir(root).catch(() => [] as string[]);
  if (entries.some((e) => e.endsWith(".uproject"))) return "unreal";
  return "none";
}

async function detectGit(root: string): Promise<GitSummary> {
  try {
    await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root });
  } catch {
    return { isRepo: false };
  }
  const [branchResult, { stdout: statusOut }] = await Promise.all([
    execFileAsync("git", ["symbolic-ref", "--short", "HEAD"], { cwd: root }).catch(() => ({ stdout: "HEAD" })),
    execFileAsync("git", ["status", "--porcelain"], { cwd: root }),
  ]);
  const dirtyFileCount = statusOut.split("\n").filter((l) => l.trim().length > 0).length;
  return { isRepo: true, branch: branchResult.stdout.trim(), dirtyFileCount };
}

async function walkForFacts(
  root: string,
  dir: string,
  languages: Set<string>,
  packageFiles: string[],
  sceneFiles: string[],
  docFiles: string[],
  depth: number,
): Promise<void> {
  if (depth > 6) return;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    // Always forward-slash, even on Windows: Unity's own asset paths are forward-slash
    // (e.g. unity-mcp reports "scenePath": "Assets/Scenes/SampleScene.unity" — confirmed
    // live 2026-08-10), and these paths get shown directly to the LLM in the project
    // context / passed back to engine tools that expect that convention, so a
    // Windows-native backslash path here (what `join()` produces) is both visually
    // inconsistent and a real mismatch against what a Unity-facing caller expects.
    const relPath = full.slice(root.length + 1).split(sep).join("/");
    if (entry.isDirectory()) {
      await walkForFacts(root, full, languages, packageFiles, sceneFiles, docFiles, depth + 1);
    } else {
      const ext = entry.name.slice(entry.name.lastIndexOf("."));
      if (LANGUAGE_EXTENSIONS[ext]) languages.add(LANGUAGE_EXTENSIONS[ext]);
      if (["package.json", "requirements.txt", "Cargo.toml", "manifest.json", "pyproject.toml"].includes(entry.name) || entry.name.endsWith(".csproj")) {
        packageFiles.push(relPath);
      }
      if (ext === ".unity") sceneFiles.push(relPath);
      if (/^(README|ARCHITECTURE|DESIGN)/i.test(entry.name)) docFiles.push(relPath);
    }
  }
}

async function topLevelSourceDirectories(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((e) => e.isDirectory() && !IGNORED_DIRS.has(e.name) && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort();
}

export async function scanProject(root: string): Promise<ProjectContext> {
  const languages = new Set<string>();
  const packageFiles: string[] = [];
  const sceneFiles: string[] = [];
  const docFiles: string[] = [];

  const [engine, git, sourceDirectories] = await Promise.all([
    detectEngine(root),
    detectGit(root),
    topLevelSourceDirectories(root),
  ]);

  await walkForFacts(root, root, languages, packageFiles, sceneFiles, docFiles, 0);

  return {
    root,
    engine,
    languages: Array.from(languages).sort(),
    packageFiles: packageFiles.sort(),
    sourceDirectories,
    sceneFiles: sceneFiles.sort(),
    docFiles: docFiles.sort(),
    git,
  };
}

/**
 * Renders a compact plain-text summary suitable for a system prompt.
 * Deliberately does NOT include file contents — callers should use
 * read_file/search_project tools for targeted retrieval instead of
 * dumping the whole project into context.
 */
export function summarizeProjectContext(ctx: ProjectContext): string {
  const lines = [
    `Project root: ${ctx.root}`,
    `Engine: ${ctx.engine}`,
    `Languages: ${ctx.languages.join(", ") || "unknown"}`,
    `Top-level directories: ${ctx.sourceDirectories.join(", ") || "(none)"}`,
    `Package/dependency files: ${ctx.packageFiles.join(", ") || "(none)"}`,
  ];
  if (ctx.sceneFiles.length) lines.push(`Scenes: ${ctx.sceneFiles.slice(0, 20).join(", ")}`);
  if (ctx.docFiles.length) lines.push(`Docs: ${ctx.docFiles.join(", ")}`);
  lines.push(
    ctx.git.isRepo
      ? `Git: branch ${ctx.git.branch}, ${ctx.git.dirtyFileCount} dirty file(s)`
      : "Git: not a repository",
  );
  return lines.join("\n");
}
