import type { ChatMessage, ContentPart } from "@gameforge/shared";
import type { FramePacingMetrics } from "./frame-metrics.js";

export interface VideoAnalysisContext {
  /** What the capture was of, e.g. "boss fight phase 2, wall-climb section". */
  label?: string;
  /** Objective pacing metrics computed by computeFramePacingMetrics, included so the model has hard numbers alongside the frames. */
  frameMetrics?: FramePacingMetrics;
  /** Free-text instruction narrowing what to focus on, e.g. "check the execution move's camera cut". */
  focus?: string;
}

/**
 * Builds the chat message a vision-capable LLMProvider should receive to
 * evaluate a gameplay capture: every sampled frame as an ImagePart plus a
 * text prompt asking specifically about motion smoothness, frame pacing,
 * camera jitter, and combo timing — the exact axes the video feedback
 * loop is meant to upgrade over static screenshot analysis. Returns a
 * plain ChatMessage; the caller passes it into Agent/LLMProvider like any
 * other message.
 */
export function buildVideoAnalysisMessage(frames: Array<{ base64Png: string }>, context: VideoAnalysisContext = {}): ChatMessage {
  const parts: ContentPart[] = [{ type: "text", text: buildPromptText(frames.length, context) }];
  for (const frame of frames) {
    parts.push({ type: "image", data: frame.base64Png, mimeType: "image/png" });
  }
  return { role: "user", content: parts };
}

function buildPromptText(frameCount: number, context: VideoAnalysisContext): string {
  const lines = [
    `Attached are ${frameCount} sequential frames sampled from a gameplay capture${context.label ? ` ("${context.label}")` : ""}.`,
    "Evaluate the capture as a game feel / playtesting reviewer would. Specifically assess:",
    "1. Motion smoothness — does character/camera movement read as continuous, or are there visible pops/teleports between frames?",
    "2. Frame pacing — does the perceived time between frames look consistent, or are some transitions noticeably longer/shorter?",
    "3. Camera jitter — is there unwanted camera shake or micro-oscillation not attributable to an intentional effect?",
    "4. Combo/attack timing — if an attack or combo is visible, does the windup/impact/recovery timing look responsive and readable?",
    "Call out specific frame numbers where you see an issue. If everything looks correct, say so plainly instead of inventing a problem.",
  ];
  if (context.frameMetrics) {
    const m = context.frameMetrics;
    lines.push(
      "",
      "Objective capture metrics (computed independently of this analysis, for cross-reference):",
      `- average interval between sampled frames: ${m.averageIntervalMs.toFixed(1)}ms`,
      `- jitter score (coefficient of variation, 0 = perfectly steady): ${m.jitterScore.toFixed(3)}`,
      `- frames with an unusually long gap before them: ${m.droppedFrameCount}`,
      `- longest single gap: ${m.longestGapMs.toFixed(1)}ms`,
    );
  }
  if (context.focus) {
    lines.push("", `Focus especially on: ${context.focus}`);
  }
  return lines.join("\n");
}
