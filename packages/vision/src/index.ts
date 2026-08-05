export { computeFramePacingMetrics } from "./frame-metrics.js";
export type { FramePacingMetrics } from "./frame-metrics.js";
export { isFfmpegAvailable, extractFrames, FfmpegNotAvailableError } from "./ffmpeg.js";
export type { ExtractedFrame, ExtractFramesOptions } from "./ffmpeg.js";
export { buildVideoAnalysisMessage } from "./video-analysis.js";
export type { VideoAnalysisContext } from "./video-analysis.js";
export { runBacktest } from "./backtest.js";
export type { CaptureRecord, BacktestThresholds, BacktestResult } from "./backtest.js";
