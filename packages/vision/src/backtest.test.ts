import { describe, expect, it } from "vitest";
import { runBacktest, type CaptureRecord } from "./backtest.js";

function record(overrides: Partial<CaptureRecord["frameMetrics"]>): CaptureRecord {
  return {
    id: "r",
    capturedAt: Date.now(),
    frameMetrics: { frameCount: 10, averageIntervalMs: 250, jitterScore: 0.05, droppedFrameCount: 0, longestGapMs: 260, ...overrides },
  };
}

describe("runBacktest", () => {
  it("passes when the new capture matches the baseline within tolerance", () => {
    const result = runBacktest(record({}), record({ jitterScore: 0.06 }));
    expect(result.passed).toBe(true);
    expect(result.regressions).toEqual([]);
  });

  it("flags a regression when jitter score increases beyond tolerance", () => {
    const result = runBacktest(record({ jitterScore: 0.05 }), record({ jitterScore: 0.2 }));
    expect(result.passed).toBe(false);
    expect(result.regressions.some((r) => r.includes("Jitter score"))).toBe(true);
  });

  it("flags a regression when average frame interval slows down beyond tolerance", () => {
    const result = runBacktest(record({ averageIntervalMs: 250 }), record({ averageIntervalMs: 400 }));
    expect(result.passed).toBe(false);
    expect(result.regressions.some((r) => r.includes("Average frame interval"))).toBe(true);
  });

  it("flags a regression when dropped-frame count increases", () => {
    const result = runBacktest(record({ droppedFrameCount: 0 }), record({ droppedFrameCount: 2 }));
    expect(result.passed).toBe(false);
    expect(result.regressions.some((r) => r.includes("Dropped-frame count"))).toBe(true);
  });

  it("reports improvements when metrics get measurably better", () => {
    const result = runBacktest(record({ jitterScore: 0.3, droppedFrameCount: 3 }), record({ jitterScore: 0.05, droppedFrameCount: 0 }));
    expect(result.passed).toBe(true);
    expect(result.improvements.length).toBeGreaterThan(0);
  });
});
