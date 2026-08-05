import { describe, expect, it } from "vitest";
import { computeFramePacingMetrics } from "./frame-metrics.js";

describe("computeFramePacingMetrics", () => {
  it("reports zero jitter for perfectly steady frame timing", () => {
    const metrics = computeFramePacingMetrics([0, 250, 500, 750, 1000]);
    expect(metrics.averageIntervalMs).toBe(250);
    expect(metrics.jitterScore).toBe(0);
    expect(metrics.droppedFrameCount).toBe(0);
  });

  it("flags a high jitter score for irregular frame timing", () => {
    const metrics = computeFramePacingMetrics([0, 100, 350, 400, 900]);
    expect(metrics.jitterScore).toBeGreaterThan(0.3);
  });

  it("counts intervals more than 2x the average as dropped frames", () => {
    const metrics = computeFramePacingMetrics([0, 100, 200, 900, 1000]); // one big 700ms gap among ~100-300ms gaps
    expect(metrics.droppedFrameCount).toBeGreaterThanOrEqual(1);
    expect(metrics.longestGapMs).toBe(700);
  });

  it("handles fewer than 2 frames without dividing by zero", () => {
    expect(computeFramePacingMetrics([])).toMatchObject({ frameCount: 0, averageIntervalMs: 0, jitterScore: 0 });
    expect(computeFramePacingMetrics([100])).toMatchObject({ frameCount: 1, averageIntervalMs: 0, jitterScore: 0 });
  });
});
