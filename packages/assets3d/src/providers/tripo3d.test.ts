import { afterEach, describe, expect, it, vi } from "vitest";
import { Tripo3DProvider } from "./tripo3d.js";

describe("Tripo3DProvider", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("submits a job and unwraps the {code, data} envelope", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ code: 0, data: { task_id: "t-1", status: "queued" } }), { status: 200 }),
    ) as unknown as typeof fetch;

    const provider = new Tripo3DProvider({ apiKey: "sk-test" });
    const job = await provider.submitJob({ prompt: "rusted broadsword" });
    expect(job).toEqual({ id: "t-1", status: "queued" });
  });

  it("throws a ProviderError when Tripo3D returns a non-zero code", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ code: 4001, message: "quota exceeded" }), { status: 200 }),
    ) as unknown as typeof fetch;

    const provider = new Tripo3DProvider({ apiKey: "sk-test" });
    await expect(provider.submitJob({ prompt: "x" })).rejects.toThrow(/quota exceeded/);
  });

  it("polls a job and maps success to a result", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          code: 0,
          data: {
            task_id: "t-1",
            status: "success",
            progress: 100,
            output: { model: "https://cdn.tripo3d.ai/model.glb", rendered_image: "https://cdn.tripo3d.ai/thumb.png" },
          },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const provider = new Tripo3DProvider({ apiKey: "sk-test" });
    const job = await provider.pollJob("t-1");
    expect(job.status).toBe("succeeded");
    expect(job.result?.modelUrl).toBe("https://cdn.tripo3d.ai/model.glb");
  });
});
