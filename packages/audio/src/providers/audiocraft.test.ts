import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioCraftProvider } from "./audiocraft.js";

describe("AudioCraftProvider", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("routes ambient_music requests to the musicgen model", async () => {
    let capturedBody: any;
    globalThis.fetch = vi.fn(async (_url, init) => {
      capturedBody = JSON.parse(init!.body as string);
      return new Response(JSON.stringify({ job_id: "a-1", status: "queued" }), { status: 200 });
    }) as unknown as typeof fetch;

    const provider = new AudioCraftProvider();
    await provider.submitJob({ prompt: "dark ambient cathedral drone", kind: "ambient_music" });
    expect(capturedBody.model).toBe("musicgen");
    expect(capturedBody.duration_seconds).toBe(30);
  });

  it("routes sound_effect requests to the audiogen model with a short default duration", async () => {
    let capturedBody: any;
    globalThis.fetch = vi.fn(async (_url, init) => {
      capturedBody = JSON.parse(init!.body as string);
      return new Response(JSON.stringify({ job_id: "a-2", status: "queued" }), { status: 200 });
    }) as unknown as typeof fetch;

    const provider = new AudioCraftProvider();
    await provider.submitJob({ prompt: "metallic clang impact", kind: "sound_effect" });
    expect(capturedBody.model).toBe("audiogen");
    expect(capturedBody.duration_seconds).toBe(3);
  });

  it("polls a job and maps a completed audio clip", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ job_id: "a-1", status: "succeeded", audio_url: "http://localhost/clip.wav", duration_seconds: 30 }), { status: 200 }),
    ) as unknown as typeof fetch;
    const provider = new AudioCraftProvider();
    const job = await provider.pollJob("a-1");
    expect(job.status).toBe("succeeded");
    expect(job.result).toEqual({ audioUrl: "http://localhost/clip.wav", format: "wav", durationSeconds: 30 });
  });
});
