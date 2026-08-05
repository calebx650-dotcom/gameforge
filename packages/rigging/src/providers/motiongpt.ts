import { ProviderError, type GenerationJob } from "@gameforge/shared";
import type { MotionProvider, MotionRequest, MotionResult } from "../motion.js";

export interface MotionGPTConfig {
  /** Base URL of a locally-running text-to-motion inference server (e.g. wrapping MotionGPT or ReGenNet). */
  baseUrl?: string;
}

interface MotionGPTJobResponse {
  job_id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  progress?: number;
  error?: string;
  output?: { bvh_url?: string; fbx_url?: string };
  duration_seconds?: number;
  fps?: number;
}

/**
 * Local-first adapter for a text-to-motion diffusion model such as
 * MotionGPT or ReGenNet, run on your own GPU rather than a hosted
 * mocap-retargeting service like DeepMotion. Unlike `DeepMotionProvider`,
 * this needs no reference video — a text description of the action
 * ("heavy two-handed overhead execution") is enough — which is the
 * whole point of a text-to-motion model versus a video-to-motion one.
 */
export class MotionGPTProvider implements MotionProvider {
  readonly id = "motiongpt";
  readonly displayName = "MotionGPT (local text-to-motion)";

  private readonly baseUrl: string;

  constructor(config: MotionGPTConfig = {}) {
    this.baseUrl = (config.baseUrl ?? "http://127.0.0.1:8002").replace(/\/$/, "");
  }

  async submitJob(request: MotionRequest): Promise<GenerationJob<MotionResult>> {
    if (!request.prompt) {
      throw new ProviderError("MotionGPT is text-driven — request.prompt is required (describe the motion, e.g. 'heavy overhead slam').");
    }
    const res = await this.fetch("/generate", {
      method: "POST",
      body: JSON.stringify({
        prompt: request.prompt,
        action_hint: request.actionType,
        rig_type: request.rigType ?? "humanoid",
        loop: request.loop ?? false,
      }),
    });
    const data = (await res.json()) as MotionGPTJobResponse;
    return { id: data.job_id, status: mapStatus(data.status) };
  }

  async pollJob(jobId: string): Promise<GenerationJob<MotionResult>> {
    const res = await this.fetch(`/jobs/${encodeURIComponent(jobId)}`);
    const data = (await res.json()) as MotionGPTJobResponse;
    const url = data.output?.bvh_url ?? data.output?.fbx_url;
    return {
      id: data.job_id,
      status: mapStatus(data.status),
      progress: data.progress,
      error: data.error,
      result: url
        ? { animationClipUrl: url, format: data.output?.bvh_url ? "bvh" : "fbx", durationSeconds: data.duration_seconds, frameRate: data.fps }
        : undefined,
    };
  }

  private async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
    } catch (err) {
      throw new ProviderError(
        `Failed to reach local MotionGPT server at ${this.baseUrl} — is it running? (${(err as Error).message})`,
        true,
        err,
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ProviderError(`MotionGPT server returned ${res.status}: ${text}`, res.status >= 500);
    }
    return res;
  }
}

function mapStatus(status: MotionGPTJobResponse["status"]): GenerationJob["status"] {
  return status;
}
