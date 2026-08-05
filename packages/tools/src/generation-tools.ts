import type { GenerationJob } from "@gameforge/shared";
import type { Text3DProvider, PBRMaterialProvider, MeshStyle } from "@gameforge/assets3d";
import type { AutoRigProvider, MotionProvider, RigType, ActionType } from "@gameforge/rigging";
import type { VoiceProvider, VoiceStyle } from "@gameforge/audio";
import { generateLevel, type LevelTheme } from "@gameforge/level-design";
import { generateBossBehaviorTree, buildComboGraph, validateComboGraph, type BossSpec } from "@gameforge/combat-ai";

/**
 * Per-session handles to whichever generative vendors the user configured
 * (or none). Kept separate from tool-call arguments so credentials never
 * flow through the model's context — the same principle already applied
 * to the main LLM's API key (see SECURITY.md). A tool call that needs a
 * provider that isn't configured fails with a clear message rather than
 * silently no-op'ing.
 */
export interface GenerationProviders {
  text3d?: Text3DProvider;
  pbr?: PBRMaterialProvider;
  autoRig?: AutoRigProvider;
  motion?: MotionProvider;
  voice?: VoiceProvider;
}

export const GENERATION_TOOL_NAMES = [
  "generate_3d_model",
  "generate_pbr_material",
  "auto_rig_model",
  "generate_motion_clip",
  "generate_voice_line",
  "generate_level_layout",
  "generate_boss_combat_design",
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
