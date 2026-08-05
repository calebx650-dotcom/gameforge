import { afterEach, describe, expect, it, vi } from "vitest";
import { MotionGPTProvider } from "./motiongpt.js";

describe("MotionGPTProvider", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("requires a text prompt since MotionGPT is text-driven, not video-driven", async () => {
    const provider = new MotionGPTProvider();
    await expect(provider.submitJob({ actionType: "attack" })).rejects.toThrow(/text-driven/);
  });

  it("submits a text-to-motion job to a local server", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ job_id: "m-1", status: "queued" }), { status: 200 })) as unknown as typeof fetch;
    const provider = new MotionGPTProvider({ baseUrl: "http://127.0.0.1:8002" });
    const job = await provider.submitJob({ actionType: "execution", prompt: "heavy two-handed overhead execution" });
    expect(job).toEqual({ id: "m-1", status: "queued" });
  });

  it("polls a job and maps a completed BVH clip", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ job_id: "m-1", status: "succeeded", output: { bvh_url: "http://localhost/clip.bvh" }, duration_seconds: 1.8, fps: 30 }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
    const provider = new MotionGPTProvider();
    const job = await provider.pollJob("m-1");
    expect(job.status).toBe("succeeded");
    expect(job.result).toEqual({ animationClipUrl: "http://localhost/clip.bvh", format: "bvh", durationSeconds: 1.8, frameRate: 30 });
  });

  it("wraps unreachable local server errors with a clear, actionable message", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const provider = new MotionGPTProvider();
    await expect(provider.submitJob({ actionType: "attack", prompt: "x" })).rejects.toThrow(/is it running/);
  });
});
