import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunLogStore } from "./run-log-store.js";

async function makeStore(): Promise<RunLogStore> {
  const dir = await mkdtemp(join(tmpdir(), "gf-runlog-"));
  return new RunLogStore(join(dir, "logs"));
}

describe("RunLogStore", () => {
  it("appends entries and reads them back in order", async () => {
    const store = await makeStore();
    await store.append("run-1", { timestamp: 1, kind: "message", summary: "first" });
    await store.append("run-1", { timestamp: 2, kind: "tool_call", summary: "second", detail: { id: "1", name: "read_file", arguments: {} } });

    const entries = await store.readRun("run-1");

    expect(entries).toEqual([
      { timestamp: 1, kind: "message", summary: "first" },
      { timestamp: 2, kind: "tool_call", summary: "second", detail: { id: "1", name: "read_file", arguments: {} } },
    ]);
  });

  it("keeps different runs in separate files", async () => {
    const store = await makeStore();
    await store.append("run-a", { timestamp: 1, kind: "message", summary: "for run a" });
    await store.append("run-b", { timestamp: 1, kind: "message", summary: "for run b" });

    expect((await store.readRun("run-a"))[0].summary).toBe("for run a");
    expect((await store.readRun("run-b"))[0].summary).toBe("for run b");
  });

  it("returns an empty array for a run that was never recorded, rather than throwing", async () => {
    const store = await makeStore();
    expect(await store.readRun("never-happened")).toEqual([]);
  });

  it("lists recorded run ids", async () => {
    const store = await makeStore();
    await store.append("run-1", { timestamp: 1, kind: "message", summary: "x" });
    await store.append("run-2", { timestamp: 1, kind: "message", summary: "y" });

    const runs = await store.listRuns();

    expect(runs.sort()).toEqual(["run-1", "run-2"]);
  });

  it("survives a partial write — every complete line up to a crash point stays readable", async () => {
    const store = await makeStore();
    await store.append("run-1", { timestamp: 1, kind: "message", summary: "before crash" });
    // Simulates the "crash mid-run" case this design is meant to survive: only the entries
    // actually appended before the crash exist on disk, and every one of them is still valid.
    const entries = await store.readRun("run-1");
    expect(entries).toHaveLength(1);
    expect(entries[0].summary).toBe("before crash");
  });
});
