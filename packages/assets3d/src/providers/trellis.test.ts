import { afterEach, describe, expect, it, vi } from "vitest";
import { TrellisProvider } from "./trellis.js";

describe("TrellisProvider", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("submits a text-conditioned job to a local server", async () => {
    let capturedBody: any;
    globalThis.fetch = vi.fn(async (_url, init) => {
      capturedBody = JSON.parse(init!.body as string);
      return new Response(JSON.stringify({ job_id: "t-1", status: "queued" }), { status: 200 });
    }) as unknown as typeof fetch;

    const provider = new TrellisProvider({ baseUrl: "http://127.0.0.1:8080" });
    const job = await provider.submitJob({ prompt: "cracked gothic gargoyle", generateCollisionMesh: true });

    expect(job).toEqual({ id: "t-1", status: "queued" });
    expect(capturedBody.prompt).toBe("cracked gothic gargoyle");
    expect(capturedBody.generate_collision_mesh).toBe(true);
  });

  it("polls a job and maps a completed result including the collision mesh", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ job_id: "t-1", status: "succeeded", model_url: "http://localhost/model.glb", collision_mesh_url: "http://localhost/model.obj" }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const provider = new TrellisProvider();
    const job = await provider.pollJob("t-1");
    expect(job.status).toBe("succeeded");
    expect(job.result).toEqual({ modelUrl: "http://localhost/model.glb", format: "glb", collisionMeshUrl: "http://localhost/model.obj" });
  });

  it("wraps unreachable local server errors with a clear, actionable message", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const provider = new TrellisProvider();
    await expect(provider.submitJob({ prompt: "x" })).rejects.toThrow(/is it running/);
  });
});
