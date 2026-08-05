import { describe, expect, it } from "vitest";
import { BlenderAutoRigProvider, isBlenderAvailable } from "./blender-auto-rig.js";

// Mirrors packages/vision's ffmpeg.test.ts: doesn't mock child_process, so
// it documents and verifies the graceful-degradation path when Blender
// genuinely isn't installed (true in this project's sandbox environment) —
// a clear, actionable error is the behavior that matters, not a raw ENOENT
// or a silent no-op.
describe("Blender availability", () => {
  it("reports availability without throwing, regardless of whether Blender is installed", async () => {
    const available = await isBlenderAvailable();
    expect(typeof available).toBe("boolean");
  });

  it("submitJob reports a failed job with a clear, actionable error when Blender is missing", async () => {
    const available = await isBlenderAvailable();
    if (available) return; // covered by the assertion below wherever Blender genuinely isn't installed

    const provider = new BlenderAutoRigProvider();
    const job = await provider.submitJob({ meshUrl: "/tmp/does-not-matter.glb", rigType: "humanoid" });
    expect(job.status).toBe("failed");
    expect(job.error).toMatch(/Blender was not found on PATH/);
  });

  it("pollJob returns the same failed job by id rather than throwing on an unreachable Blender", async () => {
    const available = await isBlenderAvailable();
    if (available) return;

    const provider = new BlenderAutoRigProvider();
    const job = await provider.submitJob({ meshUrl: "/tmp/does-not-matter.glb", rigType: "humanoid" });
    const polled = await provider.pollJob(job.id);
    expect(polled).toEqual(job);
  });
});
