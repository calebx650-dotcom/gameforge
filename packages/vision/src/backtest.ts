import type { FramePacingMetrics } from "./frame-metrics.js";

export interface CaptureRecord {
  id: string;
  capturedAt: number;
  label?: string;
  frameMetrics: FramePacingMetrics;
}

export interface BacktestThresholds {
  /** Max allowed increase in jitterScore before flagging a regression. */
  jitterScoreTolerance?: number;
  /** Max allowed percentage increase in averageIntervalMs (e.g. 0.15 = 15% slower is still OK). */
  averageIntervalTolerancePct?: number;
  /** Max allowed increase in dropped-frame count. */
  droppedFrameCountTolerance?: number;
}

export interface BacktestResult {
  passed: boolean;
  regressions: string[];
  improvements: string[];
}

const DEFAULT_THRESHOLDS: Required<BacktestThresholds> = {
  jitterScoreTolerance: 0.05,
  averageIntervalTolerancePct: 0.15,
  droppedFrameCountTolerance: 0,
};

/**
 * Compares a new gameplay capture's frame-pacing metrics against a stored
 * baseline capture of the same scenario, flagging regressions beyond a
 * tolerance instead of relying on eyeballing two videos side by side. This
 * is what turns "take a screenshot and ask the model" into an actual
 * regression test the agent's fix-and-retest loop can act on: if a change
 * makes combat noticeably jankier, the backtest catches it even if the
 * model's qualitative read is ambiguous.
 */
export function runBacktest(baseline: CaptureRecord, current: CaptureRecord, thresholds: BacktestThresholds = {}): BacktestResult {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const regressions: string[] = [];
  const improvements: string[] = [];

  const jitterDelta = current.frameMetrics.jitterScore - baseline.frameMetrics.jitterScore;
  if (jitterDelta > t.jitterScoreTolerance) {
    regressions.push(
      `Jitter score increased from ${baseline.frameMetrics.jitterScore.toFixed(3)} to ${current.frameMetrics.jitterScore.toFixed(3)} (tolerance ${t.jitterScoreTolerance}).`,
    );
  } else if (jitterDelta < -t.jitterScoreTolerance) {
    improvements.push(`Jitter score improved from ${baseline.frameMetrics.jitterScore.toFixed(3)} to ${current.frameMetrics.jitterScore.toFixed(3)}.`);
  }

  const baselineInterval = baseline.frameMetrics.averageIntervalMs;
  const intervalDeltaPct = baselineInterval > 0 ? (current.frameMetrics.averageIntervalMs - baselineInterval) / baselineInterval : 0;
  if (intervalDeltaPct > t.averageIntervalTolerancePct) {
    regressions.push(
      `Average frame interval increased ${(intervalDeltaPct * 100).toFixed(1)}% (${baselineInterval.toFixed(1)}ms -> ${current.frameMetrics.averageIntervalMs.toFixed(1)}ms), suggesting slower/less consistent pacing.`,
    );
  } else if (intervalDeltaPct < -t.averageIntervalTolerancePct) {
    improvements.push(`Average frame interval improved ${(Math.abs(intervalDeltaPct) * 100).toFixed(1)}%.`);
  }

  const droppedDelta = current.frameMetrics.droppedFrameCount - baseline.frameMetrics.droppedFrameCount;
  if (droppedDelta > t.droppedFrameCountTolerance) {
    regressions.push(`Dropped-frame count increased from ${baseline.frameMetrics.droppedFrameCount} to ${current.frameMetrics.droppedFrameCount}.`);
  } else if (droppedDelta < 0) {
    improvements.push(`Dropped-frame count improved from ${baseline.frameMetrics.droppedFrameCount} to ${current.frameMetrics.droppedFrameCount}.`);
  }

  return { passed: regressions.length === 0, regressions, improvements };
}
