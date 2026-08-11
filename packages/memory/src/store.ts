import { createRequire } from "node:module";

// Loaded via createRequire rather than a static ESM import so that
// bundler-based test runners (Vite/Vitest) don't try to resolve
// "node:sqlite" as a package — this hands resolution to Node itself.
const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

export type MemoryCategory =
  | "description"
  | "architecture_decision"
  | "convention"
  | "important_file"
  | "design_note"
  | "known_bug"
  | "completed_feature"
  | "user_preference"
  | "development_goal"
  | "custom";

export interface MemoryEntry {
  id: number;
  category: MemoryCategory;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export interface RunHistoryEntry {
  id: number;
  startedAt: number;
  /** The user's request for this run, truncated — enough to recognize what was asked, not the full text. */
  requestSummary: string;
  stoppedReason: string;
  iterations: number;
  /** e.g. "2 met, 1 unmet, 0 pending" — derived from Agent.run()'s taskPlan.requirements, omitted if the run never used the planning tools. */
  requirementsSummary?: string;
}

export interface RecordRunInput {
  requestSummary: string;
  stoppedReason: string;
  iterations: number;
  requirementsSummary?: string;
}

/**
 * Project-level memory backed by SQLite (Node's built-in node:sqlite —
 * no native module to compile, which keeps this package trivially
 * installable across platforms). One database per project.
 */
type DatabaseSyncInstance = InstanceType<typeof DatabaseSync>;

export class MemoryStore {
  private readonly db: DatabaseSyncInstance;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        content TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS run_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        startedAt INTEGER NOT NULL,
        requestSummary TEXT NOT NULL,
        stoppedReason TEXT NOT NULL,
        iterations INTEGER NOT NULL,
        requirementsSummary TEXT
      );
    `);
  }

  add(category: MemoryCategory, content: string): MemoryEntry {
    const now = Date.now();
    const stmt = this.db.prepare(
      "INSERT INTO memory_entries (category, content, createdAt, updatedAt) VALUES (?, ?, ?, ?)",
    );
    const result = stmt.run(category, content, now, now);
    return { id: Number(result.lastInsertRowid), category, content, createdAt: now, updatedAt: now };
  }

  update(id: number, content: string): void {
    const now = Date.now();
    this.db.prepare("UPDATE memory_entries SET content = ?, updatedAt = ? WHERE id = ?").run(content, now, id);
  }

  remove(id: number): void {
    this.db.prepare("DELETE FROM memory_entries WHERE id = ?").run(id);
  }

  list(category?: MemoryCategory): MemoryEntry[] {
    const rows = category
      ? this.db.prepare("SELECT * FROM memory_entries WHERE category = ? ORDER BY id").all(category)
      : this.db.prepare("SELECT * FROM memory_entries ORDER BY id").all();
    return rows as unknown as MemoryEntry[];
  }

  /** Compact summary for inclusion in the agent's system prompt. */
  summarize(): string {
    const entries = this.list();
    if (entries.length === 0) return "(no project memory yet)";
    const byCategory = new Map<string, string[]>();
    for (const entry of entries) {
      const list = byCategory.get(entry.category) ?? [];
      list.push(entry.content);
      byCategory.set(entry.category, list);
    }
    return Array.from(byCategory.entries())
      .map(([category, items]) => `${category}:\n${items.map((i) => `  - ${i}`).join("\n")}`)
      .join("\n");
  }

  /**
   * Records one `Agent.run()`'s outcome — the P3.5 "agent memory" gap:
   * `list()`/`summarize()` above are *project* memory (facts about the
   * codebase), not memory of what the agent itself has tried across
   * separate runs. Called once per chat request after the run settles
   * (see `apps/server/src/chat-socket.ts`), never mid-run.
   */
  recordRun(input: RecordRunInput): RunHistoryEntry {
    const startedAt = Date.now();
    const stmt = this.db.prepare(
      "INSERT INTO run_history (startedAt, requestSummary, stoppedReason, iterations, requirementsSummary) VALUES (?, ?, ?, ?, ?)",
    );
    const result = stmt.run(startedAt, input.requestSummary, input.stoppedReason, input.iterations, input.requirementsSummary ?? null);
    return { id: Number(result.lastInsertRowid), startedAt, ...input };
  }

  /** Most recent runs first. */
  recentRuns(limit = 5): RunHistoryEntry[] {
    const rows = this.db.prepare("SELECT * FROM run_history ORDER BY id DESC LIMIT ?").all(limit);
    return (rows as any[]).map((r) => ({
      id: r.id,
      startedAt: r.startedAt,
      requestSummary: r.requestSummary,
      stoppedReason: r.stoppedReason,
      iterations: r.iterations,
      requirementsSummary: r.requirementsSummary ?? undefined,
    }));
  }

  /** Compact summary for inclusion in the agent's system prompt — oldest-of-the-recent-set first, so it reads chronologically. */
  summarizeRunHistory(limit = 5): string {
    const runs = this.recentRuns(limit);
    if (runs.length === 0) return "(no prior runs recorded for this project)";
    return runs
      .reverse()
      .map((r) => {
        const when = new Date(r.startedAt).toISOString();
        const reqs = r.requirementsSummary ? `, requirements: ${r.requirementsSummary}` : "";
        return `- [${when}] "${r.requestSummary}" -> ${r.stoppedReason} (${r.iterations} iteration(s)${reqs})`;
      })
      .join("\n");
  }

  close(): void {
    this.db.close();
  }
}
