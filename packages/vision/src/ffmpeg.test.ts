import { describe, expect, it } from "vitest";
import { isFfmpegAvailable, extractFrames, FfmpegNotAvailableError } from "./ffmpeg.js";

// This suite intentionally does NOT mock child_process: it documents and
// verifies the graceful-degradation path when ffmpeg genuinely isn't
// installed (true in this project's CI/sandbox environment), which is the
// behavior that matters most — silently doing nothing or crashing with a
// raw ENOENT would be worse than a clear, actionable error.
describe("ffmpeg availability", () => {
  it("reports availability without throwing, regardless of whether ffmpeg is installed", async () => {
    const available = await isFfmpegAvailable();
    expect(typeof available).toBe("boolean");
  });

  it("extractFrames raises a clear, actionable error when ffmpeg is missing", async () => {
    const available = await isFfmpegAvailable();
    if (available) {
      // ffmpeg happens to be installed in this environment; the missing-binary
      // path is covered by the assertion below wherever it isn't.
      return;
    }
    await expect(extractFrames("/tmp/does-not-matter.mp4")).rejects.toThrow(FfmpegNotAvailableError);
    await expect(extractFrames("/tmp/does-not-matter.mp4")).rejects.toThrow(/ffmpeg was not found/);
  });
});
