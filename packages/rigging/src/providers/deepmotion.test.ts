import { afterEach, describe, expect, it, vi } from "vitest";
import { DeepMotionProvider } from "./deepmotion.js";

describe("DeepMotionProvider", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("requires a referenceVideoUrl", async () => {
    const provider = new DeepMotionProvider({ apiKey: "sk-test" });
    await expect(provider.submitJob({ actionType: "attack" })).rejects.toThrow(/referenceVideoUrl/);
  });

  it("submits a motion capture job from a reference video", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ job_id: "m-1", status: "pending" }), { status: 200 })) as unknown as typeof fetch;
    const provider = new DeepMotionProvider({ apiKey: "sk-test" });
    const job = await provider.submitJob({ actionType: "hit-reaction", referenceVideoUrl: "https://example.com/ref.mp4" });
    expect(job).toEqual({ id: "m-1", status: "queued" });
  });

  it("polls a job and maps a completed animation clip", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          job_id: "m-1",
          status: "success",
          outputs: { fbx_url: "https://cdn.deepmotion.com/clip.fbx" },
          duration_seconds: 2.4,
          fps: 30,
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
    const provider = new DeepMotionProvider({ apiKey: "sk-test" });
    const job = await provider.pollJob("m-1");
    expect(job.status).toBe("succeeded");
    expect(job.result).toEqual({
      animationClipUrl: "https://cdn.deepmotion.com/clip.fbx",
      format: "fbx",
      durationSeconds: 2.4,
      frameRate: 30,
    });
  });
});
