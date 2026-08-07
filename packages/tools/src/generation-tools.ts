import type { GenerationJob } from "@gameforge/shared";
import type { Text3DProvider, PBRMaterialProvider, MeshStyle } from "@gameforge/assets3d";
import type { AutoRigProvider, MotionProvider, RigType, ActionType } from "@gameforge/rigging";
import { generateLocomotionAnimatorController, generateRagdollConfig, generateHumanoidAvatarMapping, type HumanoidSlot } from "@gameforge/rigging";
import type { VoiceProvider, VoiceStyle, MusicGenerationProvider, AudioClipKind } from "@gameforge/audio";
import { generateLevel, generateProBuilderCommands, type LevelTheme, type LevelLayout } from "@gameforge/level-design";
import { generateBossBehaviorTree, buildComboGraph, validateComboGraph, type BossSpec } from "@gameforge/combat-ai";
import {
  generateAtmosphericFogShader,
  generateGrimeOverlayShader,
  generateNightVisionPostProcessShader,
  generatePostProcessingProfile,
} from "@gameforge/shader-synthesis";

/**
 * Per-session handles to whichever generative vendors the user configured
 * (or none). Kept separate from tool-call arguments so credentials never
 * flow through the model's context — the same principle already applied
 * to the main LLM's API key (see SECURITY.md). A tool call that needs a
 * provider that isn't configured fails with a clear message rather than
 * silently no-op'ing. Each of these interfaces has at least one
 * local-first implementation available (TripoSR/TRELLIS, Blender/
 * MotionGPT, Kokoro/XTTS/AudioCraft) alongside the cloud vendors — see
 * PROVIDERS.md.
 */
export interface GenerationProviders {
  text3d?: Text3DProvider;
  pbr?: PBRMaterialProvider;
  autoRig?: AutoRigProvider;
  motion?: MotionProvider;
  voice?: VoiceProvider;
  music?: MusicGenerationProvider;
}

/**
 * Maps each vendor-backed generation tool to the `GenerationProviders` key
 * it needs configured to actually work. Used to decide whether to advertise
 * the tool to the model at all for a given session (see tool-scope.ts) —
 * the eight pure/local tools in `GENERATION_TOOL_NAMES` below need no entry
 * here since they need no provider.
 */
export const GENERATION_TOOL_PROVIDER_KEY: Partial<Record<string, keyof GenerationProviders>> = {
  generate_3d_model: "text3d",
  generate_pbr_material: "pbr",
  auto_rig_model: "autoRig",
  generate_motion_clip: "motion",
  generate_voice_line: "voice",
  generate_ambient_audio: "music",
};

export const GENERATION_TOOL_NAMES = [
  "generate_3d_model",
  "generate_pbr_material",
  "auto_rig_model",
  "generate_motion_clip",
  "generate_voice_line",
  "generate_ambient_audio",
  "generate_level_layout",
  "generate_boss_combat_design",
  "generate_shader",
  "generate_post_processing_profile",
  "export_level_geometry",
  "generate_animator_controller",
  "generate_humanoid_avatar_mapping",
  "generate_ragdoll_config",
] as const;

interface PollOptions {
  intervalMs?: number;
  timeoutMs?: number;
}

/**
 * Every generation vendor is an async submit-then-poll job. GameForge's
 * agent loop calls tools synchronously, so this blocks (with a bounded
 * timeout) until the job settles rather than exposing job polling as a
 * separate tool the model would have to remember to call — simpler for
 * the model, at the cost of holding one agent iteration open while a
 * (typically 10s-2min) generation job runs.
 */
async function pollUntilSettled<T>(
  poll: (jobId: string) => Promise<GenerationJob<T>>,
  jobId: string,
  { intervalMs = 2000, timeoutMs = 120_000 }: PollOptions = {},
): Promise<GenerationJob<T>> {
  const start = Date.now();
  let job = await poll(jobId);
  while (job.status === "queued" || job.status === "running") {
    if (Date.now() - start > timeoutMs) {
      return { ...job, status: "failed", error: `Timed out after ${timeoutMs}ms waiting for generation job ${jobId}` };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    job = await poll(jobId);
  }
  return job;
}

export function isGenerationTool(name: string): boolean {
  return (GENERATION_TOOL_NAMES as readonly string[]).includes(name);
}

export async function dispatchGenerationTool(
  name: string,
  args: Record<string, unknown>,
  providers: GenerationProviders,
  pollOptions?: PollOptions,
): Promise<string> {
  switch (name) {
    case "generate_3d_model": {
      const provider = requireProvider(providers.text3d, "text-to-3D");
      const job = await provider.submitJob({
        prompt: String(args.prompt),
        style: args.style as MeshStyle | undefined,
        negativePrompt: args.negativePrompt as string | undefined,
        generateCollisionMesh: Boolean(args.generateCollisionMesh),
      });
      return JSON.stringify(await pollUntilSettled((id) => provider.pollJob(id), job.id, pollOptions));
    }
    case "generate_pbr_material": {
      const provider = requireProvider(providers.pbr, "PBR material");
      const job = await provider.submitJob({
        prompt: String(args.prompt),
        resolution: args.resolution as 512 | 1024 | 2048 | 4096 | undefined,
        seamlessTiling: args.seamlessTiling as boolean | undefined,
      });
      return JSON.stringify(await pollUntilSettled((id) => provider.pollJob(id), job.id, pollOptions));
    }
    case "auto_rig_model": {
      const provider = requireProvider(providers.autoRig, "auto-rig");
      const job = await provider.submitJob({
        meshUrl: String(args.meshUrl),
        rigType: (args.rigType as RigType) ?? "humanoid",
        heightMeters: args.heightMeters as number | undefined,
      });
      return JSON.stringify(await pollUntilSettled((id) => provider.pollJob(id), job.id, pollOptions));
    }
    case "generate_motion_clip": {
      const provider = requireProvider(providers.motion, "motion");
      const job = await provider.submitJob({
        actionType: args.actionType as ActionType,
        prompt: args.prompt as string | undefined,
        referenceVideoUrl: args.referenceVideoUrl as string | undefined,
        rigType: args.rigType as "humanoid" | "quadruped" | "custom" | undefined,
      });
      return JSON.stringify(await pollUntilSettled((id) => provider.pollJob(id), job.id, pollOptions));
    }
    case "generate_voice_line": {
      const provider = requireProvider(providers.voice, "voice");
      const job = await provider.submitJob({
        text: String(args.text),
        voiceId: String(args.voiceId),
        style: args.style as VoiceStyle | undefined,
      });
      return JSON.stringify(await pollUntilSettled((id) => provider.pollJob(id), job.id, pollOptions));
    }
    case "generate_ambient_audio": {
      const provider = requireProvider(providers.music, "music generation");
      const job = await provider.submitJob({
        prompt: String(args.prompt),
        kind: (args.kind as AudioClipKind) ?? "ambient_music",
        durationSeconds: args.durationSeconds as number | undefined,
      });
      return JSON.stringify(await pollUntilSettled((id) => provider.pollJob(id), job.id, pollOptions));
    }
    case "generate_level_layout": {
      const result = generateLevel({
        theme: args.theme as LevelTheme,
        seed: args.seed as number | undefined,
        roomCount: args.roomCount as number | undefined,
      });
      return JSON.stringify(result);
    }
    case "generate_boss_combat_design": {
      const spec = args.spec as BossSpec;
      const errors = validateComboGraph(spec);
      if (errors.length > 0) throw new Error(`Invalid boss spec: ${errors.join("; ")}`);
      const behaviorTree = generateBossBehaviorTree(spec);
      const comboGraph = Object.fromEntries(buildComboGraph(spec).edges);
      return JSON.stringify({ behaviorTree, comboGraph });
    }
    case "generate_shader": {
      const kind = String(args.kind);
      if (kind === "atmospheric_fog") return generateAtmosphericFogShader(args as Record<string, never>);
      if (kind === "grime_overlay") return generateGrimeOverlayShader(args as Record<string, never>);
      if (kind === "night_vision") return generateNightVisionPostProcessShader(args as Record<string, never>);
      throw new Error(`Unknown shader kind: ${kind}. Expected atmospheric_fog, grime_overlay, or night_vision.`);
    }
    case "generate_post_processing_profile": {
      const profile = generatePostProcessingProfile(args.theme as LevelTheme);
      return JSON.stringify(profile);
    }
    case "export_level_geometry": {
      const layout = args.layout as LevelLayout;
      const commands = generateProBuilderCommands(layout, {
        wallHeight: args.wallHeight as number | undefined,
        wallThickness: args.wallThickness as number | undefined,
        corridorWidth: args.corridorWidth as number | undefined,
      });
      return JSON.stringify(commands);
    }
    case "generate_animator_controller": {
      const controller = generateLocomotionAnimatorController({
        idleClip: args.idleClip as string | undefined,
        walkClip: args.walkClip as string | undefined,
        runClip: args.runClip as string | undefined,
        attackClips: args.attackClips as string[] | undefined,
        hitReactionClip: args.hitReactionClip as string | undefined,
      });
      return JSON.stringify(controller);
    }
    case "generate_humanoid_avatar_mapping": {
      const mapping = generateHumanoidAvatarMapping(args.boneNames as string[]);
      return JSON.stringify(mapping);
    }
    case "generate_ragdoll_config": {
      const boneMap = args.boneMap as Partial<Record<HumanoidSlot, string>>;
      const configs = generateRagdollConfig(boneMap);
      return JSON.stringify(configs);
    }
    default:
      throw new Error(`No generation tool implementation for: ${name}`);
  }
}

function requireProvider<T>(provider: T | undefined, label: string): T {
  if (!provider) {
    throw new Error(`No ${label} provider configured for this session — pick one in the asset generation settings first.`);
  }
  return provider;
}
