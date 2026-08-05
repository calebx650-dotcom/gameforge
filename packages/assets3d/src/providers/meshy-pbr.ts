import { ProviderError, type GenerationJob } from "@gameforge/shared";
import type { PBRMaterialProvider, PBRMaterialRequest, PBRMaterialResult } from "../pbr-material.js";

export interface MeshyPBRConfig {
  apiKey: string;
  baseUrl?: string;
}

interface MeshyTextureTaskResponse {
  id: string;
  status: "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED";
  progress?: number;
  task_error?: { message?: string };
  texture_urls?: { base_color?: string; normal?: string; roughness?: string; metallic?: string };
}

/** Adapter for Meshy's text-to-texture API, producing a full PBR channel set. */
export class MeshyPBRProvider implements PBRMaterialProvider {
  readonly id = "meshy-pbr";
  readonly displayName = "Meshy (PBR texture)";

  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: MeshyPBRConfig) {
    if (!config.apiKey) throw new ProviderError("Meshy provider requires an API key");
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? "https://api.meshy.ai").replace(/\/$/, "");
  }

  async submitJob(request: PBRMaterialRequest): Promise<GenerationJob<PBRMaterialResult>> {
    const res = await this.fetch("/v1/text-to-texture", {
      method: "POST",
      body: JSON.stringify({
        prompt: request.prompt,
        resolution: request.resolution ?? 1024,
        seamless: request.seamlessTiling ?? true,
      }),
    });
    const data = (await res.json()) as { result: string };
    return { id: data.result, status: "queued" };
  }

  async pollJob(jobId: string): Promise<GenerationJob<PBRMaterialResult>> {
    const res = await this.fetch(`/v1/text-to-texture/${encodeURIComponent(jobId)}`);
    const data = (await res.json()) as MeshyTextureTaskResponse;
    const urls = data.texture_urls;
    const complete = urls?.base_color && urls.normal && urls.roughness && urls.metallic;
    return {
      id: data.id,
      status: mapStatus(data.status),
      progress: data.progress,
      error: data.task_error?.message,
      result: complete
        ? { albedoUrl: urls.base_color!, normalUrl: urls.normal!, roughnessUrl: urls.roughness!, metallicUrl: urls.metallic! }
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

function mapStatus(status: MeshyTextureTaskResponse["status"]): GenerationJob["status"] {
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
