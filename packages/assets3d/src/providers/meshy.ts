import { ProviderError, type GenerationJob } from "@gameforge/shared";
import type { Text3DProvider, Text3DRequest, Text3DResult } from "../text-to-3d.js";

export interface MeshyConfig {
  apiKey: string;
  baseUrl?: string;
}

interface MeshyTaskResponse {
  id: string;
  status: "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED";
  progress?: number;
  task_error?: { message?: string };
  model_urls?: { glb?: string; fbx?: string; obj?: string };
  thumbnail_url?: string;
}

/**
 * Adapter for Meshy's text-to-3D API (https://docs.meshy.ai). Submits a
 * "preview" generation task and polls it. Field names follow Meshy's
 * documented v2 task-based flow; if Meshy changes their wire format this
 * is the one file that needs updating — nothing else in GameForge depends
 * on Meshy's specific response shape.
 */
export class MeshyProvider implements Text3DProvider {
  readonly id = "meshy";
  readonly displayName = "Meshy";

  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: MeshyConfig) {
    if (!config.apiKey) throw new ProviderError("Meshy provider requires an API key");
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? "https://api.meshy.ai").replace(/\/$/, "");
  }

  async submitJob(request: Text3DRequest): Promise<GenerationJob<Text3DResult>> {
    const res = await this.fetch("/v2/text-to-3d", {
      method: "POST",
      body: JSON.stringify({
        mode: "preview",
        prompt: request.prompt,
        negative_prompt: request.negativePrompt,
        art_style: request.style === "low-poly" ? "low-poly" : "realistic",
        should_remesh: request.generateCollisionMesh ?? false,
      }),
    });
    const data = (await res.json()) as { result: string };
    return { id: data.result, status: "queued" };
  }

  async pollJob(jobId: string): Promise<GenerationJob<Text3DResult>> {
    const res = await this.fetch(`/v2/text-to-3d/${encodeURIComponent(jobId)}`);
    const data = (await res.json()) as MeshyTaskResponse;
    return {
      id: data.id,
      status: mapStatus(data.status),
      progress: data.progress,
      error: data.task_error?.message,
      result: data.model_urls?.glb
        ? {
            modelUrl: data.model_urls.glb,
            format: "glb",
            collisionMeshUrl: data.model_urls.obj,
            thumbnailUrl: data.thumbnail_url,
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

function mapStatus(status: MeshyTaskResponse["status"]): GenerationJob["status"] {
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
