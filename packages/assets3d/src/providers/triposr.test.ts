import { afterEach, describe, expect, it, vi } from "vitest";
import { TripoSRProvider } from "./triposr.js";

describe("TripoSRProvider", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("requires an imageUrl since TripoSR is image-conditioned, not text-conditioned", async () => {
    const provider = new TripoSRProvider();
    await expect(provider.submitJob({ prompt: "a gargoyle" })).rejects.toThrow(/image-conditioned/);
  });

  it("generates a mesh synchronously from a local server and returns an already-succeeded job", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ model_url: "http://localhost/mesh.glb", format: "glb" }), { status: 200})) as unknown as typeof fetch;

    const provider = new TripoSRProvider({ baseUrl: "http://127.0.0.1:7860" });
    const job = await provider.submitJob({ prompt: "gargoyle concept", imageUrl: "data:image/png;base64,abc" });

    expect(job.status).toBe("succeeded");
    expect(job.result?.modelUrl).toBe("http://localhost/mesh.glb");

    const polled = await provider.pollJob(job.id);
    expect(polled).toEqual(job);
  });

  it("marks the job failed with a clear message when the local server isn't reachable", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    const provider = new TripoSRProvider();
    const job = await provider.submitJob({ prompt: "x", imageUrl: "data:image/png;base64,abc" });
    expect(job.status).toBe("failed");
    expect(job.error).toMatch(/is it running/);
  });
});
