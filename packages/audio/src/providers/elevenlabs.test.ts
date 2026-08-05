import { afterEach, describe, expect, it, vi } from "vitest";
import { ElevenLabsProvider } from "./elevenlabs.js";

describe("ElevenLabsProvider", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("requires an API key", () => {
    expect(() => new ElevenLabsProvider({ apiKey: "" })).toThrow(/API key/);
  });

  it("synthesizes audio synchronously and returns an already-succeeded job", async () => {
    let capturedHeaders: Record<string, string> | undefined;
    let capturedBody: any;
    globalThis.fetch = vi.fn(async (_url, init) => {
      capturedHeaders = init!.headers as Record<string, string>;
      capturedBody = JSON.parse(init!.body as string);
      return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
    }) as unknown as typeof fetch;

    const provider = new ElevenLabsProvider({ apiKey: "sk-test" });
    const job = await provider.submitJob({ text: "You should not have come here.", voiceId: "voice-1", style: "growl" });

    expect(job.status).toBe("succeeded");
    expect(job.result?.format).toBe("mp3");
    expect(job.result?.audioUrl).toMatch(/^data:audio\/mpeg;base64,/);
    expect(capturedHeaders?.["xi-api-key"]).toBe("sk-test");
    expect(capturedBody.voice_settings.style).toBeCloseTo(0.7);

    const polled = await provider.pollJob(job.id);
    expect(polled).toEqual(job);
  });

  it("marks the job failed on a non-2xx response instead of throwing", async () => {
    globalThis.fetch = vi.fn(async () => new Response("quota exceeded", { status: 429 })) as unknown as typeof fetch;
    const provider = new ElevenLabsProvider({ apiKey: "sk-test" });
    const job = await provider.submitJob({ text: "x", voiceId: "voice-1" });
    expect(job.status).toBe("failed");
    expect(job.error).toMatch(/429/);
  });

  it("throws when polling an unknown job id", async () => {
    const provider = new ElevenLabsProvider({ apiKey: "sk-test" });
    await expect(provider.pollJob("nonexistent")).rejects.toThrow(/Unknown generation job/);
  });
});
