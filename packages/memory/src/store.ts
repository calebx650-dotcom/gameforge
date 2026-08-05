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

  close(): void {
    this.db.close();
  }
}
