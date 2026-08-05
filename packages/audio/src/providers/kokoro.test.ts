import { afterEach, describe, expect, it, vi } from "vitest";
import { KokoroProvider } from "./kokoro.js";

describe("KokoroProvider", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("hits the OpenAI-compatible /v1/audio/speech shape and returns a succeeded job synchronously", async () => {
    let capturedBody: any;
    globalThis.fetch = vi.fn(async (_url, init) => {
      capturedBody = JSON.parse(init!.body as string);
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }) as unknown as typeof fetch;

    const provider = new KokoroProvider({ baseUrl: "http://127.0.0.1:8880" });
    const job = await provider.submitJob({ text: "Get out.", voiceId: "af_bella" });

    expect(job.status).toBe("succeeded");
    expect(job.result?.format).toBe("mp3");
    expect(capturedBody).toEqual({ model: "kokoro", input: "Get out.", voice: "af_bella", response_format: "mp3" });

    const polled = await provider.pollJob(job.id);
    expect(polled).toEqual(job);
  });

  it("marks the job failed with a clear message when the local server isn't reachable", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const provider = new KokoroProvider();
    const job = await provider.submitJob({ text: "x", voiceId: "af_bella" });
    expect(job.status).toBe("failed");
    expect(job.error).toMatch(/is it running/);
  });
});
