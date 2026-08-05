import { ProviderError, type GenerationJob } from "@gameforge/shared";
import type { AutoRigProvider, AutoRigRequest, AutoRigResult } from "../auto-rig.js";

export interface MeshyRigConfig {
  apiKey: string;
  baseUrl?: string;
}

interface MeshyRiggingResponse {
  id: string;
  status: "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED";
  progress?: number;
  task_error?: { message?: string };
  result?: { rigged_model_url?: string; bone_count?: number; skeleton_type?: string };
}

/** Adapter for Meshy's auto-rigging API: takes a mesh URL, returns a rigged model. */
export class MeshyAutoRigProvider implements AutoRigProvider {
  readonly id = "meshy-rig";
  readonly displayName = "Meshy (auto-rig)";

  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: MeshyRigConfig) {
    if (!config.apiKey) throw new ProviderError("Meshy provider requires an API key");
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? "https://api.meshy.ai").replace(/\/$/, "");
  }

  async submitJob(request: AutoRigRequest): Promise<GenerationJob<AutoRigResult>> {
    const res = await this.fetch("/openapi/v1/rigging", {
      method: "POST",
      body: JSON.stringify({
        model_url: request.meshUrl,
        rig_type: request.rigType,
        height_meters: request.heightMeters,
      }),
    });
    const data = (await res.json()) as { result: string };
    return { id: data.result, status: "queued" };
  }

  async pollJob(jobId: string): Promise<GenerationJob<AutoRigResult>> {
    const res = await this.fetch(`/openapi/v1/rigging/${encodeURIComponent(jobId)}`);
    const data = (await res.json()) as MeshyRiggingResponse;
    return {
      id: data.id,
      status: mapStatus(data.status),
      progress: data.progress,
      error: data.task_error?.message,
      result: data.result?.rigged_model_url
        ? {
            riggedModelUrl: data.result.rigged_model_url,
            boneCount: data.result.bone_count,
            skeletonType: data.result.skeleton_type,
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
      throw new ProviderError(`Failed to reach Meshy: ${(err as Error).message}`, true, err);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ProviderError(`Meshy request failed (${res.status}): ${text}`, res.status >= 500 || res.status === 429);
    }
    return res;
  }
}

function mapStatus(status: MeshyRiggingResponse["status"]): GenerationJob["status"] {
  switch (status) {
    case "PENDING":
      return "queued";
    case "IN_PROGRESS":
      return "running";
    case "SUCCEEDED":
      return "succeeded";
    case "FAILED":
      return "failed";
  }
}
