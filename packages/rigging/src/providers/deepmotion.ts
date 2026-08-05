import { ProviderError, type GenerationJob } from "@gameforge/shared";
import type { MotionProvider, MotionRequest, MotionResult } from "../motion.js";

export interface DeepMotionConfig {
  apiKey: string;
  baseUrl?: string;
}

interface DeepMotionJobResponse {
  job_id: string;
  status: "pending" | "processing" | "success" | "failed";
  progress?: number;
  error_message?: string;
  outputs?: { fbx_url?: string; glb_url?: string; bvh_url?: string };
  duration_seconds?: number;
  fps?: number;
}

/**
 * Adapter for DeepMotion's Animate 3D API. Accepts either a reference
 * video (motion capture -> retargeted animation) or a text prompt describing
 * the desired action for vendors that support text-to-motion; DeepMotion's
 * current public API is video-driven, so `prompt` is sent as metadata for
 * retargeting hints rather than the primary generation input.
 */
export class DeepMotionProvider implements MotionProvider {
  readonly id = "deepmotion";
  readonly displayName = "DeepMotion";

  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: DeepMotionConfig) {
    if (!config.apiKey) throw new ProviderError("DeepMotion provider requires an API key");
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? "https://api.deepmotion.com").replace(/\/$/, "");
  }

  async submitJob(request: MotionRequest): Promise<GenerationJob<MotionResult>> {
    if (!request.referenceVideoUrl) {
      throw new ProviderError("DeepMotion requires a referenceVideoUrl to drive motion capture");
    }
    const res = await this.fetch("/api/jobs", {
      method: "POST",
      body: JSON.stringify({
        video_url: request.referenceVideoUrl,
        action_hint: request.actionType,
        prompt: request.prompt,
        rig_type: request.rigType ?? "humanoid",
        loop: request.loop ?? false,
      }),
    });
    const data = (await res.json()) as DeepMotionJobResponse;
    return { id: data.job_id, status: mapStatus(data.status) };
  }

  async pollJob(jobId: string): Promise<GenerationJob<MotionResult>> {
    const res = await this.fetch(`/api/jobs/${encodeURIComponent(jobId)}`);
    const data = (await res.json()) as DeepMotionJobResponse;
    const url = data.outputs?.fbx_url ?? data.outputs?.glb_url;
    return {
      id: data.job_id,
      status: mapStatus(data.status),
      progress: data.progress,
      error: data.error_message,
      result: url
        ? {
            animationClipUrl: url,
            format: data.outputs?.fbx_url ? "fbx" : "glb",
            durationSeconds: data.duration_seconds,
            frameRate: data.fps,
          }
        : undefined,
    };
  }

  private async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          ...(init.headers ?? {}),
        },
      });
    } catch (err) {
      throw new ProviderError(`Failed to reach DeepMotion: ${(err as Error).message}`, true, err);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ProviderError(`DeepMotion request failed (${res.status}): ${text}`, res.status >= 500 || res.status === 429);
    }
    return res;
  }
}

function mapStatus(status: DeepMotionJobResponse["status"]): GenerationJob["status"] {
  switch (status) {
    case "pending":
      return "queued";
    case "processing":
      return "running";
    case "success":
      return "succeeded";
    case "failed":
      return "failed";
  }
}
