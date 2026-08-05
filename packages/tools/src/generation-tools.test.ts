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

  it("generates a shader as text via the free local shader synthesis tool", async () => {
    const result = await dispatchGenerationTool("generate_shader", { kind: "atmospheric_fog", shaderName: "Test/Fog" }, {});
    expect(result).toContain('Shader "Test/Fog"');
  });

  it("rejects an unknown shader kind", async () => {
    await expect(dispatchGenerationTool("generate_shader", { kind: "bogus" }, {})).rejects.toThrow(/Unknown shader kind/);
  });

  it("generates a themed post-processing profile via the free local tool", async () => {
    const result = await dispatchGenerationTool("generate_post_processing_profile", { theme: "asylum_hallway" }, {});
    expect(JSON.parse(result).theme).toBe("asylum_hallway");
  });

  it("exports level geometry as ProBuilder commands from a level layout", async () => {
    const layoutResult = await dispatchGenerationTool("generate_level_layout", { theme: "urban_arena", seed: 1, roomCount: 3 }, {});
    const { layout } = JSON.parse(layoutResult);
    const result = await dispatchGenerationTool("export_level_geometry", { layout }, {});
    const commands = JSON.parse(result);
    expect(commands.some((c: { type: string }) => c.type === "BuildRoomShell")).toBe(true);
  });

  it("generates a humanoid avatar mapping and feeds it into ragdoll config generation", async () => {
    const mappingResult = await dispatchGenerationTool(
      "generate_humanoid_avatar_mapping",
      { boneNames: ["Hips", "Spine", "Head", "LeftUpperArm", "LeftLowerArm", "LeftHand", "RightUpperArm", "RightLowerArm", "RightHand", "LeftUpperLeg", "LeftLowerLeg", "LeftFoot", "RightUpperLeg", "RightLowerLeg", "RightFoot"] },
      {},
    );
    const mapping = JSON.parse(mappingResult);
    expect(mapping.isValid).toBe(true);

    const ragdollResult = await dispatchGenerationTool("generate_ragdoll_config", { boneMap: mapping.boneMap }, {});
    const configs = JSON.parse(ragdollResult);
    expect(configs.some((c: { boneName: string }) => c.boneName === "Head")).toBe(true);
  });

  it("generates a locomotion animator controller via the free local tool", async () => {
    const result = await dispatchGenerationTool("generate_animator_controller", { attackClips: ["Slash"] }, {});
    const controller = JSON.parse(result);
    expect(controller.defaultState).toBe("Locomotion");
  });

  it("requires a configured music generation provider for generate_ambient_audio", async () => {
    await expect(dispatchGenerationTool("generate_ambient_audio", { prompt: "dark drone", kind: "ambient_music" }, {})).rejects.toThrow(
      /No music generation provider configured/,
    );
  });
});
