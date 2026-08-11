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

  it("records a run's real outcome and returns it with a real id and timestamp", () => {
    const store = new MemoryStore(":memory:");
    const entry = store.recordRun({
      requestSummary: "Add a sprint/stamina system",
      stoppedReason: "completed",
      iterations: 6,
      requirementsSummary: "2 met, 0 unmet, 1 pending",
    });
    expect(entry.id).toBeGreaterThan(0);
    expect(entry.startedAt).toBeGreaterThan(0);
    expect(entry.requestSummary).toBe("Add a sprint/stamina system");
    store.close();
  });

  it("returns recent runs most-recent-first", () => {
    const store = new MemoryStore(":memory:");
    store.recordRun({ requestSummary: "first request", stoppedReason: "completed", iterations: 1 });
    store.recordRun({ requestSummary: "second request", stoppedReason: "completed", iterations: 2 });
    store.recordRun({ requestSummary: "third request", stoppedReason: "max_iterations", iterations: 10 });

    const recent = store.recentRuns(2);

    expect(recent).toHaveLength(2);
    expect(recent[0].requestSummary).toBe("third request");
    expect(recent[1].requestSummary).toBe("second request");
  });

  it("summarizes run history chronologically (oldest of the recent set first) for inclusion in the system prompt", () => {
    const store = new MemoryStore(":memory:");
    store.recordRun({ requestSummary: "add sprint", stoppedReason: "completed", iterations: 4, requirementsSummary: "1 met" });
    store.recordRun({ requestSummary: "fix stamina bar", stoppedReason: "file_limit_reached", iterations: 12 });

    const summary = store.summarizeRunHistory();

    expect(summary).toContain("add sprint");
    expect(summary).toContain("fix stamina bar");
    expect(summary.indexOf("add sprint")).toBeLessThan(summary.indexOf("fix stamina bar"));
    expect(summary).toContain("1 met");
    expect(summary).toContain("file_limit_reached");
    store.close();
  });

  it("reports empty run history clearly", () => {
    const store = new MemoryStore(":memory:");
    expect(store.summarizeRunHistory()).toBe("(no prior runs recorded for this project)");
    store.close();
  });
});
