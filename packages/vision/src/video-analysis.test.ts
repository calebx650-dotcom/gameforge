import { describe, expect, it } from "vitest";
import { buildVideoAnalysisMessage } from "./video-analysis.js";
import { computeFramePacingMetrics } from "./frame-metrics.js";

describe("buildVideoAnalysisMessage", () => {
  it("includes one ImagePart per frame plus a leading text prompt", () => {
    const frames = [{ base64Png: "aaa" }, { base64Png: "bbb" }, { base64Png: "ccc" }];
    const message = buildVideoAnalysisMessage(frames);

    expect(message.role).toBe("user");
    const parts = message.content as any[];
    expect(parts[0].type).toBe("text");
    expect(parts.slice(1)).toEqual([
      { type: "image", data: "aaa", mimeType: "image/png" },
      { type: "image", data: "bbb", mimeType: "image/png" },
      { type: "image", data: "ccc", mimeType: "image/png" },
    ]);
  });

  it("asks about motion smoothness, frame pacing, camera jitter, and combo timing", () => {
    const message = buildVideoAnalysisMessage([{ base64Png: "x" }]);
    const text = (message.content as any[])[0].text as string;
    expect(text).toMatch(/motion smoothness/i);
    expect(text).toMatch(/frame pacing/i);
    expect(text).toMatch(/camera jitter/i);
    expect(text).toMatch(/combo.*timing/i);
  });

  it("includes objective frame metrics and the focus/label context when provided", () => {
    const metrics = computeFramePacingMetrics([0, 250, 500, 750]);
    const message = buildVideoAnalysisMessage([{ base64Png: "x" }], {
      label: "wall-climb section",
      focus: "the camera cut at the ledge grab",
      frameMetrics: metrics,
    });
    const text = (message.content as any[])[0].text as string;
    expect(text).toContain("wall-climb section");
    expect(text).toContain("the camera cut at the ledge grab");
    expect(text).toContain("jitter score");
  });
});
