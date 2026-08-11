import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { MemoryStore } from "@gameforge/memory";
import { scanProject, type ProjectContext } from "@gameforge/project";
import { WorkspaceGuard } from "@gameforge/tools";
import { RunLogStore } from "./run-log-store.js";

export interface ProjectSession {
  id: string;
  root: string;
  guard: WorkspaceGuard;
  memory: MemoryStore;
  context: ProjectContext;
  runLogs: RunLogStore;
}

/**
 * Tracks every project the desktop UI has opened this run. One
 * WorkspaceGuard + MemoryStore per project keeps them fully isolated from
 * each other — a tool call for project A can never touch project B's files.
 */
export class ProjectManager {
  private readonly sessions = new Map<string, ProjectSession>();

  async open(root: string): Promise<ProjectSession> {
    const existing = Array.from(this.sessions.values()).find((s) => s.root === root);
    if (existing) {
      existing.context = await scanProject(root);
      return existing;
    }

    const gameforgeDir = join(root, ".gameforge");
    await mkdir(gameforgeDir, { recursive: true });

    const id = randomUUID();
    const session: ProjectSession = {
      id,
      root,
      guard: new WorkspaceGuard(root),
      memory: new MemoryStore(join(gameforgeDir, "memory.sqlite3")),
      context: await scanProject(root),
      runLogs: new RunLogStore(join(gameforgeDir, "logs")),
    };
    this.sessions.set(id, session);
    return session;
  }

  get(id: string): ProjectSession | undefined {
    return this.sessions.get(id);
  }

  list(): ProjectSession[] {
    return Array.from(this.sessions.values());
  }

  async rescan(id: string): Promise<ProjectSession | undefined> {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    session.context = await scanProject(session.root);
    return session;
  }
}
