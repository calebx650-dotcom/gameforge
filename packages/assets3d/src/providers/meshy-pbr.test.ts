import { afterEach, describe, expect, it, vi } from "vitest";
import { MeshyPBRProvider } from "./meshy-pbr.js";

describe("MeshyPBRProvider", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("submits a texture job", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ result: "tex-1" }), { status: 200 })) as unknown as typeof fetch;
    const provider = new MeshyPBRProvider({ apiKey: "sk-test" });
    const job = await provider.submitJob({ prompt: "decayed fabric" });
    expect(job).toEqual({ id: "tex-1", status: "queued" });
  });

  it("only reports a result once every PBR channel URL is present", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ id: "tex-1", status: "IN_PROGRESS", texture_urls: { base_color: "url" } }), { status: 200 }),
    ) as unknown as typeof fetch;
    const provider = new MeshyPBRProvider({ apiKey: "sk-test" });
    const job = await provider.pollJob("tex-1");
    expect(job.status).toBe("running");
    expect(job.result).toBeUndefined();
  });

  it("returns the full PBR channel set once succeeded", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: "tex-1",
          status: "SUCCEEDED",
          texture_urls: { base_color: "a", normal: "n", roughness: "r", metallic: "m" },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
    const provider = new MeshyPBRProvider({ apiKey: "sk-test" });
    const job = await provider.pollJob("tex-1");
    expect(job.status).toBe("succeeded");
    expect(job.result).toEqual({ albedoUrl: "a", normalUrl: "n", roughnessUrl: "r", metallicUrl: "m" });
  });
});
