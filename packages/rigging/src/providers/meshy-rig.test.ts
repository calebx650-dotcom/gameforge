import { afterEach, describe, expect, it, vi } from "vitest";
import { MeshyAutoRigProvider } from "./meshy-rig.js";

describe("MeshyAutoRigProvider", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("submits a rigging job for a humanoid mesh", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ result: "rig-1" }), { status: 200 })) as unknown as typeof fetch;
    const provider = new MeshyAutoRigProvider({ apiKey: "sk-test" });
    const job = await provider.submitJob({ meshUrl: "https://cdn/model.glb", rigType: "humanoid", heightMeters: 1.8 });
    expect(job).toEqual({ id: "rig-1", status: "queued" });
  });

  it("polls a job and maps a completed rigged model", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: "rig-1",
          status: "SUCCEEDED",
          result: { rigged_model_url: "https://cdn/rigged.glb", bone_count: 54, skeleton_type: "humanoid" },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
    const provider = new MeshyAutoRigProvider({ apiKey: "sk-test" });
    const job = await provider.pollJob("rig-1");
    expect(job.status).toBe("succeeded");
    expect(job.result).toEqual({ riggedModelUrl: "https://cdn/rigged.glb", boneCount: 54, skeletonType: "humanoid" });
  });
});
