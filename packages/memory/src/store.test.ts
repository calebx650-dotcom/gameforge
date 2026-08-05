import { describe, expect, it } from "vitest";
import { MemoryStore } from "./store.js";

describe("MemoryStore", () => {
  it("adds, lists, updates, and removes entries", () => {
    const store = new MemoryStore(":memory:");
    const entry = store.add("known_bug", "Player falls through floor on level 2");
    expect(entry.id).toBeGreaterThan(0);

    expect(store.list()).toHaveLength(1);
    expect(store.list("known_bug")).toHaveLength(1);
    expect(store.list("completed_feature")).toHaveLength(0);

    store.update(entry.id, "Fixed: player falls through floor on level 2");
    expect(store.list()[0].content).toContain("Fixed");

    store.remove(entry.id);
    expect(store.list()).toHaveLength(0);
    store.close();
  });

  it("summarizes entries grouped by category", () => {
    const store = new MemoryStore(":memory:");
    store.add("convention", "Use 4-space indentation in C#");
    store.add("convention", "PascalCase for MonoBehaviour class names");
    store.add("development_goal", "Ship vertical slice of level 1");

    const summary = store.summarize();
    expect(summary).toContain("convention:");
    expect(summary).toContain("development_goal:");
    expect(summary).toContain("PascalCase");
    store.close();
  });

  it("reports empty memory clearly", () => {
    const store = new MemoryStore(":memory:");
    expect(store.summarize()).toBe("(no project memory yet)");
    store.close();
  });
});
