import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { WorkspaceGuard } from "./workspace.js";

const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "build", ".gameforge"]);

export async function readFileTool(guard: WorkspaceGuard, path: string): Promise<string> {
  const target = await guard.resolveReal(path);
  return readFile(target, "utf-8");
}

export interface DirectoryEntry {
  name: string;
  type: "file" | "directory";
}

export async function listDirectoryTool(guard: WorkspaceGuard, path = "."): Promise<DirectoryEntry[]> {
  const target = await guard.resolveReal(path);
  const entries = await readdir(target, { withFileTypes: true });
  return entries
    .filter((e) => !IGNORED_DIRS.has(e.name))
    .map((e) => ({ name: e.name, type: (e.isDirectory() ? "directory" : "file") as "file" | "directory" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface SearchMatch {
  file: string;
  line: number;
  text: string;
}

export async function searchProjectTool(
  guard: WorkspaceGuard,
  query: string,
  maxResults = 100,
): Promise<SearchMatch[]> {
  const results: SearchMatch[] = [];
  let pattern: RegExp;
  try {
    pattern = new RegExp(query, "i");
  } catch {
    pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  }

  async function walk(dir: string): Promise<void> {
    if (results.length >= maxResults) return;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= maxResults) return;
      if (IGNORED_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const st = await stat(full);
        if (st.size > 2_000_000) continue; // skip huge/binary-ish files
        let content: string;
        try {
          content = await readFile(full, "utf-8");
        } catch {
          continue;
        }
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (pattern.test(lines[i])) {
            results.push({ file: relative(guard.root, full), line: i + 1, text: lines[i].trim().slice(0, 300) });
            if (results.length >= maxResults) break;
          }
        }
      }
    }
  }

  await walk(guard.root);
  return results;
}

export async function createFileTool(guard: WorkspaceGuard, path: string, content: string): Promise<void> {
  const target = guard.resolve(path);
  try {
    await stat(target);
    throw new Error(`File already exists: ${path}`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, content, "utf-8");
}

export async function editFileTool(guard: WorkspaceGuard, path: string, oldText: string, newText: string): Promise<void> {
  const target = await guard.resolveReal(path);
  const content = await readFile(target, "utf-8");
  if (!content.includes(oldText)) {
    throw new Error(`oldText not found in ${path}`);
  }
  await writeFile(target, content.replace(oldText, newText), "utf-8");
}

export async function deleteFileTool(guard: WorkspaceGuard, path: string): Promise<void> {
  const target = await guard.resolveReal(path);
  await rm(target, { force: true });
}

export async function createDirectoryTool(guard: WorkspaceGuard, path: string): Promise<void> {
  const target = guard.resolve(path);
  await mkdir(target, { recursive: true });
}
