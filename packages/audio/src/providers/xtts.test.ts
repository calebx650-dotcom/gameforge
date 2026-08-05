import { afterEach, describe, expect, it, vi } from "vitest";
import { XTTSProvider } from "./xtts.js";

describe("XTTSProvider", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("requires reference audio for voice cloning", async () => {
    const provider = new XTTSProvider();
    await expect(provider.submitJob({ text: "hello", voiceId: "unused" })).rejects.toThrow(/reference audio/);
  });

  it("clones a voice from reference audio and returns wav audio synchronously", async () => {
    let capturedBody: any;
    globalThis.fetch = vi.fn(async (_url, init) => {
      capturedBody = JSON.parse(init!.body as string);
      return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
    }) as unknown as typeof fetch;

    const provider = new XTTSProvider({ baseUrl: "http://127.0.0.1:5002" });
    const job = await provider.submitJob({
      text: "You should not have come here.",
      voiceId: "unused",
      referenceAudioUrl: "https://example.com/npc-reference.wav",
      language: "en",
    });

    expect(job.status).toBe("succeeded");
    expect(job.result?.format).toBe("wav");
    expect(job.result?.audioUrl).toMatch(/^data:audio\/wav;base64,/);
    expect(capturedBody.speaker_wav).toBe("https://example.com/npc-reference.wav");
  });

  it("marks the job failed on a non-2xx response", async () => {
    globalThis.fetch = vi.fn(async () => new Response("bad request", { status: 400 })) as unknown as typeof fetch;
    const provider = new XTTSProvider();
    const job = await provider.submitJob({ text: "x", voiceId: "unused", referenceAudioUrl: "https://example.com/ref.wav" });
    expect(job.status).toBe("failed");
    expect(job.error).toMatch(/400/);
  });
});
