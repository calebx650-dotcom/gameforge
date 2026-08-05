import { describe, expect, it, vi } from "vitest";
import { dispatchGenerationTool, isGenerationTool } from "./generation-tools.js";
import type { Text3DProvider } from "@gameforge/assets3d";
import type { VoiceProvider } from "@gameforge/audio";

function fakeText3D(): Text3DProvider {
  return {
    id: "fake",
    displayName: "Fake",
    submitJob: vi.fn(async () => ({ id: "job-1", status: "queued" as const })),
    pollJob: vi.fn(async () => ({ id: "job-1", status: "succeeded" as const, result: { modelUrl: "https://cdn/model.glb", format: "glb" as const } })),
  };
}

describe("isGenerationTool", () => {
  it("recognizes the generation tool names and rejects everything else", () => {
    expect(isGenerationTool("generate_3d_model")).toBe(true);
    expect(isGenerationTool("generate_level_layout")).toBe(true);
    expect(isGenerationTool("read_file")).toBe(false);
  });
});

describe("dispatchGenerationTool", () => {
  it("submits and polls a text-to-3D job to completion", async () => {
    const provider = fakeText3D();
    const result = await dispatchGenerationTool("generate_3d_model", { prompt: "gothic gargoyle" }, { text3d: provider });
    expect(provider.submitJob).toHaveBeenCalledWith(expect.objectContaining({ prompt: "gothic gargoyle" }));
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe("succeeded");
    expect(parsed.result.modelUrl).toBe("https://cdn/model.glb");
  });

  it("throws a clear error when the required provider isn't configured", async () => {
    await expect(dispatchGenerationTool("generate_3d_model", { prompt: "x" }, {})).rejects.toThrow(/No text-to-3D provider configured/);
  });

  it("times out a job that never settles instead of hanging forever", async () => {
    const provider: Text3DProvider = {
      id: "slow",
      displayName: "Slow",
      submitJob: vi.fn(async () => ({ id: "job-1", status: "queued" as const })),
      pollJob: vi.fn(async () => ({ id: "job-1", status: "running" as const })),
    };
    const result = await dispatchGenerationTool("generate_3d_model", { prompt: "x" }, { text3d: provider }, { intervalMs: 1, timeoutMs: 10 });
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe("failed");
    expect(parsed.error).toMatch(/Timed out/);
  });

  it("runs the free local level-layout generator with no provider needed", async () => {
    const result = await dispatchGenerationTool("generate_level_layout", { theme: "gothic_cathedral", seed: 1, roomCount: 5 }, {});
    const parsed = JSON.parse(result);
    expect(parsed.layout.rooms).toHaveLength(5);
  });

  it("runs the free local boss combat design generator and rejects an invalid spec", async () => {
    const validSpec = {
      name: "Boss",
      phases: [{ name: "p1", healthThreshold: 1, attacks: [{ name: "jab", cooldownSeconds: 1, damage: 5, range: "melee" }] }],
    };
    const okResult = await dispatchGenerationTool("generate_boss_combat_design", { spec: validSpec }, {});
    expect(JSON.parse(okResult).behaviorTree.type).toBe("selector");

    const brokenSpec = {
      name: "Boss",
      phases: [{ name: "p1", healthThreshold: 1, attacks: [{ name: "jab", cooldownSeconds: 1, damage: 5, range: "melee", comboChain: ["ghost"] }] }],
    };
    await expect(dispatchGenerationTool("generate_boss_combat_design", { spec: brokenSpec }, {})).rejects.toThrow(/Invalid boss spec/);
  });

  it("synthesizes a voice line via a configured voice provider", async () => {
    const voice: VoiceProvider = {
      id: "fake-voice",
      displayName: "Fake Voice",
      submitJob: vi.fn(async () => ({ id: "v-1", status: "succeeded" as const, result: { audioUrl: "data:audio/mpeg;base64,AAAA", format: "mp3" as const } })),
      pollJob: vi.fn(async () => ({ id: "v-1", status: "succeeded" as const, result: { audioUrl: "data:audio/mpeg;base64,AAAA", format: "mp3" as const } })),
    };
    const result = await dispatchGenerationTool("generate_voice_line", { text: "Begone.", voiceId: "v1", style: "growl" }, { voice });
    expect(JSON.parse(result).status).toBe("succeeded");
  });
});
