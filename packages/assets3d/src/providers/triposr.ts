import { ProviderError, type GenerationJob } from "@gameforge/shared";
import type { Text3DProvider, Text3DRequest, Text3DResult } from "../text-to-3d.js";

export interface TripoSRConfig {
  /** Base URL of a locally-running TripoSR inference server (VAST-AI-Research/TripoSR). No API key — it's your own GPU. */
  baseUrl?: string;
}

interface TripoSRResponse {
  model_url: string;
  format?: "glb" | "obj";
}

/**
 * Local-first adapter for VAST-AI-Research/TripoSR — a fast (<0.5s on a
 * single GPU) image-to-3D model you run yourself, no cloud account, no
 * per-generation cost, no data leaving your machine. This is what
 * GameForge should default to when the user wants to work offline: point
 * it at a small local inference server wrapping TripoSR's `run()` call
 * (a ~20-line FastAPI/Flask wrapper around the upstream repo) instead of
 * calling Meshy/Tripo3D over the network.
 *
 * TripoSR is image-conditioned, not text-conditioned — `imageUrl` is
 * required; `prompt` is carried through only as a label for logs/UI.
 */
export class TripoSRProvider implements Text3DProvider {
  readonly id = "triposr";
  readonly displayName = "TripoSR (local)";

  private readonly baseUrl: string;
  private readonly completedJobs = new Map<string, GenerationJob<Text3DResult>>();

  constructor(config: TripoSRConfig = {}) {
    this.baseUrl = (config.baseUrl ?? "http://127.0.0.1:7860").replace(/\/$/, "");
  }

  async submitJob(request: Text3DRequest): Promise<GenerationJob<Text3DResult>> {
    if (!request.imageUrl) {
      throw new ProviderError("TripoSR is image-conditioned — request.imageUrl is required (pass a source image or reference render).");
    }
    const id = `triposr-${Date.now()}`;
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_url: request.imageUrl, remove_background: true }),
      });
    } catch (err) {
      const job: GenerationJob<Text3DResult> = {
        id,
        status: "failed",
        error: `Failed to reach local TripoSR server at ${this.baseUrl} — is it running? (${(err as Error).message})`,
      };
      this.completedJobs.set(id, job);
      return job;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const job: GenerationJob<Text3DResult> = { id, status: "failed", error: `TripoSR server returned ${res.status}: ${text}` };
      this.completedJobs.set(id, job);
      return job;
    }

    const data = (await res.json()) as TripoSRResponse;
    const job: GenerationJob<Text3DResult> = {
      id,
      status: "succeeded",
      result: { modelUrl: data.model_url, format: data.format ?? "glb" },
    };
    this.completedJobs.set(id, job);
    return job;
  }

  async pollJob(jobId: string): Promise<GenerationJob<Text3DResult>> {
    const job = this.completedJobs.get(jobId);
    if (!job) throw new ProviderError(`Unknown generation job: ${jobId}`);
    return job;
  }
}
