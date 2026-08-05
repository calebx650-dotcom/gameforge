import { afterEach, describe, expect, it, vi } from "vitest";
import { MeshyProvider } from "./meshy.js";

describe("MeshyProvider", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("submits a text-to-3d job and returns a queued GenerationJob", async () => {
    let capturedBody: any;
    globalThis.fetch = vi.fn(async (_url, init) => {
      capturedBody = JSON.parse(init!.body as string);
      return new Response(JSON.stringify({ result: "task-123" }), { status: 200 });
    }) as unknown as typeof fetch;

    const provider = new MeshyProvider({ apiKey: "sk-test" });
    const job = await provider.submitJob({ prompt: "gothic stone gargoyle", style: "low-poly", generateCollisionMesh: true });

    expect(job).toEqual({ id: "task-123", status: "queued" });
    expect(capturedBody.art_style).toBe("low-poly");
    expect(capturedBody.should_remesh).toBe(true);
  });

  it("polls a job and maps SUCCEEDED to a result with model + collision mesh URLs", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: "task-123",
          status: "SUCCEEDED",
          progress: 100,
          model_urls: { glb: "https://cdn.meshy.ai/model.glb", obj: "https://cdn.meshy.ai/model.obj" },
          thumbnail_url: "https://cdn.meshy.ai/thumb.png",
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const provider = new MeshyProvider({ apiKey: "sk-test" });
    const job = await provider.pollJob("task-123");

    expect(job.status).toBe("succeeded");
    expect(job.result?.modelUrl).toBe("https://cdn.meshy.ai/model.glb");
    expect(job.result?.collisionMeshUrl).toBe("https://cdn.meshy.ai/model.obj");
  });

  it("maps FAILED status and surfaces the task error message", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ id: "task-123", status: "FAILED", task_error: { message: "prompt rejected" } }), {
        status: 200,
      }),
    ) as unknown as typeof fetch;

    const provider = new MeshyProvider({ apiKey: "sk-test" });
    const job = await provider.pollJob("task-123");
    expect(job.status).toBe("failed");
    expect(job.error).toBe("prompt rejected");
  });

  it("requires an API key", () => {
    expect(() => new MeshyProvider({ apiKey: "" })).toThrow(/API key/);
  });
});
