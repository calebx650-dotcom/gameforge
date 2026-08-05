import { describe, expect, it } from "vitest";
import { LiveFrameBuffer } from "./live-frame-stream.js";

function frame(timestampMs: number, byteLength = 100) {
  return { base64: "x".repeat(4), mimeType: "image/png", timestampMs, byteLength };
}

describe("LiveFrameBuffer", () => {
  it("returns pushed frames in order", () => {
    const buffer = new LiveFrameBuffer();
    buffer.pushFrame(frame(0));
    buffer.pushFrame(frame(33));
    buffer.pushFrame(frame(66));
    expect(buffer.getRecentFrames().map((f) => f.timestampMs)).toEqual([0, 33, 66]);
  });

  it("drops the oldest frame once maxFrames is exceeded, never blocking the producer", () => {
    const buffer = new LiveFrameBuffer({ maxFrames: 3 });
    for (let i = 0; i < 5; i++) buffer.pushFrame(frame(i * 10));
    const stats = buffer.stats();
    expect(stats.frameCount).toBe(3);
    expect(stats.droppedFrameCount).toBe(2);
    expect(buffer.getRecentFrames().map((f) => f.timestampMs)).toEqual([20, 30, 40]);
  });

  it("drops the oldest frames once the total byte budget is exceeded", () => {
    const buffer = new LiveFrameBuffer({ maxFrames: 100, maxBytesTotal: 250 });
    buffer.pushFrame(frame(0, 100));
    buffer.pushFrame(frame(10, 100));
    buffer.pushFrame(frame(20, 100)); // pushes total to 300 > 250, must evict oldest
    const stats = buffer.stats();
    expect(stats.totalBytes).toBeLessThanOrEqual(250);
    expect(buffer.getRecentFrames().some((f) => f.timestampMs === 0)).toBe(false);
  });

  it("getRecentFrames(n) returns only the most recent n frames", () => {
    const buffer = new LiveFrameBuffer();
    for (let i = 0; i < 5; i++) buffer.pushFrame(frame(i));
    expect(buffer.getRecentFrames(2).map((f) => f.timestampMs)).toEqual([3, 4]);
  });

  it("reports oldest/newest timestamps and clears cleanly", () => {
    const buffer = new LiveFrameBuffer();
    buffer.pushFrame(frame(5));
    buffer.pushFrame(frame(15));
    expect(buffer.stats()).toMatchObject({ frameCount: 2, oldestTimestampMs: 5, newestTimestampMs: 15 });
    buffer.clear();
    expect(buffer.stats().frameCount).toBe(0);
    expect(buffer.stats().totalBytes).toBe(0);
  });
});
