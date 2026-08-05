import { afterEach, describe, expect, it, vi } from "vitest";
import { GenericImagePBRProvider } from "./generic-image-pbr.js";

describe("GenericImagePBRProvider", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("generates all four PBR channels via four image requests and returns succeeded immediately", async () => {
    const seenPrompts: string[] = [];
    globalThis.fetch = vi.fn(async (_url, init) => {
      const body = JSON.parse(init!.body as string);
      seenPrompts.push(body.prompt);
      return new Response(JSON.stringify({ data: [{ url: `https://img/${seenPrompts.length}` }] }), { status: 200 });
    }) as unknown as typeof fetch;

    const provider = new GenericImagePBRProvider({ apiKey: "sk-test" });
    const job = await provider.submitJob({ prompt: "metallic sheen" });

    expect(job.status).toBe("succeeded");
    expect(job.result?.albedoUrl).toMatch(/^https:\/\/img\//);
    expect(job.result?.normalUrl).toMatch(/^https:\/\/img\//);
    expect(job.result?.roughnessUrl).toMatch(/^https:\/\/img\//);
    expect(job.result?.metallicUrl).toMatch(/^https:\/\/img\//);
    expect(seenPrompts).toHaveLength(4);
    expect(seenPrompts.some((p) => p.includes("normal map"))).toBe(true);

    const polled = await provider.pollJob(job.id);
    expect(polled).toEqual(job);
  });

  it("marks the job failed if any channel request fails, without throwing", async () => {
    globalThis.fetch = vi.fn(async () => new Response("server error", { status: 500 })) as unknown as typeof fetch;
    const provider = new GenericImagePBRProvider({ apiKey: "sk-test" });
    const job = await provider.submitJob({ prompt: "x" });
    expect(job.status).toBe("failed");
    expect(job.error).toMatch(/500/);
  });
});
