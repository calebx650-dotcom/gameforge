import { ProviderError, type GenerationJob } from "@gameforge/shared";
import type { Text3DProvider, Text3DRequest, Text3DResult } from "../text-to-3d.js";

export interface TrellisConfig {
  /** Base URL of a locally-running TRELLIS inference server (microsoft/TRELLIS). No API key — it's your own GPU. */
  baseUrl?: string;
}

interface TrellisJobResponse {
  job_id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  progress?: number;
  error?: string;
  model_url?: string;
  collision_mesh_url?: string;
}

/**
 * Local-first adapter for microsoft/TRELLIS, a state-of-the-art
 * open-source structured-latent 3D generation model that produces
 * higher-resolution shapes (and, unlike TripoSR, can also be prompted
 * from text) at the cost of more compute time — hence the async
 * submit/poll shape rather than TripoSR's near-instant synchronous call.
 * Same "run it yourself, no cloud account" pitch as TripoSR: point
 * `baseUrl` at a local inference server wrapping TRELLIS's pipeline.
 */
export class TrellisProvider implements Text3DProvider {
  readonly id = "trellis";
  readonly displayName = "TRELLIS (local)";

  private readonly baseUrl: string;

  constructor(config: TrellisConfig = {}) {
    this.baseUrl = (config.baseUrl ?? "http://127.0.0.1:8080").replace(/\/$/, "");
  }

  async submitJob(request: Text3DRequest): Promise<GenerationJob<Text3DResult>> {
    const res = await this.fetch("/generate", {
      method: "POST",
      body: JSON.stringify({
        prompt: request.prompt,
        image_url: request.imageUrl,
        negative_prompt: request.negativePrompt,
        generate_collision_mesh: request.generateCollisionMesh ?? false,
      }),
    });
    const data = (await res.json()) as TrellisJobResponse;
    return { id: data.job_id, status: mapStatus(data.status) };
  }

  async pollJob(jobId: string): Promise<GenerationJob<Text3DResult>> {
    const res = await this.fetch(`/jobs/${encodeURIComponent(jobId)}`);
    const data = (await res.json()) as TrellisJobResponse;
    return {
      id: data.job_id,
      status: mapStatus(data.status),
      progress: data.progress,
      error: data.error,
      result: data.model_url ? { modelUrl: data.model_url, format: "glb", collisionMeshUrl: data.collision_mesh_url } : undefined,
    };
  }

  private async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
    } catch (err) {
      throw new ProviderError(
        `Failed to reach local TRELLIS server at ${this.baseUrl} — is it running? (${(err as Error).message})`,
        true,
        err,
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ProviderError(`TRELLIS server returned ${res.status}: ${text}`, res.status >= 500);
    }
    return res;
  }
}

function mapStatus(status: TrellisJobResponse["status"]): GenerationJob["status"] {
  return status;
}
