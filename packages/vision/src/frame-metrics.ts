export interface FramePacingMetrics {
  frameCount: number;
  averageIntervalMs: number;
  /** Coefficient of variation of frame intervals (stddev / mean) — 0 is perfectly steady, higher is janky/stuttery. */
  jitterScore: number;
  /** Intervals more than 2x the average — a frame that took twice as long to arrive as expected. */
  droppedFrameCount: number;
  longestGapMs: number;
}

/**
 * Computes objective frame-pacing metrics from a list of frame
 * timestamps (milliseconds since capture start), independent of any LLM
 * judgment. This gives the visual feedback loop a hard number to check
 * (and backtest against later) alongside the model's qualitative read of
 * "does the motion look smooth" — the two are complementary, not a
 * replacement for one another.
 */
export function computeFramePacingMetrics(frameTimestampsMs: number[]): FramePacingMetrics {
  if (frameTimestampsMs.length < 2) {
    return { frameCount: frameTimestampsMs.length, averageIntervalMs: 0, jitterScore: 0, droppedFrameCount: 0, longestGapMs: 0 };
  }

  const intervals: number[] = [];
  for (let i = 1; i < frameTimestampsMs.length; i++) {
    intervals.push(frameTimestampsMs[i] - frameTimestampsMs[i - 1]);
  }

  const average = intervals.reduce((sum, v) => sum + v, 0) / intervals.length;
  const variance = intervals.reduce((sum, v) => sum + (v - average) ** 2, 0) / intervals.length;
  const stddev = Math.sqrt(variance);
  const jitterScore = average > 0 ? stddev / average : 0;
  const droppedFrameCount = intervals.filter((v) => v > average * 2).length;
  const longestGapMs = Math.max(...intervals);

  return {
    frameCount: frameTimestampsMs.length,
    averageIntervalMs: average,
    jitterScore,
    droppedFrameCount,
    longestGapMs,
  };
}
