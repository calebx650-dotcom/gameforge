import { ProviderError, type GenerationJob } from "@gameforge/shared";
import type { Text3DProvider, Text3DRequest, Text3DResult } from "../text-to-3d.js";

export interface Tripo3DConfig {
  apiKey: string;
  baseUrl?: string;
}

interface Tripo3DTaskResponse {
  code: number;
  data: {
    task_id: string;
    status: "queued" | "running" | "success" | "failed";
    progress?: number;
    output?: { model?: string; pbr_model?: string; rendered_image?: string };
  };
  message?: string;
}

/**
 * Adapter for Tripo3D's text-to-model API. Same submit/poll shape as
 * Meshy but a different response envelope (`{ code, data }`).
 */
export class Tripo3DProvider implements Text3DProvider {
  readonly id = "tripo3d";
  readonly displayName = "Tripo3D";

  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: Tripo3DConfig) {
    if (!config.apiKey) throw new ProviderError("Tripo3D provider requires an API key");
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? "https://api.tripo3d.ai").replace(/\/$/, "");
  }

  async submitJob(request: Text3DRequest): Promise<GenerationJob<Text3DResult>> {
    const res = await this.fetch("/v2/openapi/task", {
      method: "POST",
      body: JSON.stringify({
        type: "text_to_model",
        prompt: request.prompt,
        negative_prompt: request.negativePrompt,
      }),
    });
    const data = (await res.json()) as Tripo3DTaskResponse;
    if (data.code !== 0) throw new ProviderError(`Tripo3D rejected the job: ${data.message ?? "unknown error"}`);
    return { id: data.data.task_id, status: "queued" };
  }

  async pollJob(jobId: string): Promise<GenerationJob<Text3DResult>> {
    const res = await this.fetch(`/v2/openapi/task/${encodeURIComponent(jobId)}`);
    const data = (await res.json()) as Tripo3DTaskResponse;
    return {
      id: data.data.task_id,
      status: mapStatus(data.data.status),
      progress: data.data.progress,
      error: data.data.status === "failed" ? data.message ?? "Tripo3D job failed" : undefined,
      result: data.data.output?.model
        ? {
            modelUrl: data.data.output.model,
            format: "glb",
            collisionMeshUrl: data.data.output.pbr_model,
            thumbnailUrl: data.data.output.rendered_image,
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
      throw new ProviderError(`Failed to reach Tripo3D: ${(err as Error).message}`, true, err);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ProviderError(`Tripo3D request failed (${res.status}): ${text}`, res.status >= 500 || res.status === 429);
    }
    return res;
  }
}

function mapStatus(status: Tripo3DTaskResponse["data"]["status"]): GenerationJob["status"] {
  switch (status) {
    case "queued":
      return "queued";
    case "running":
      return "running";
    case "success":
      return "succeeded";
    case "failed":
      return "failed";
  }
}
