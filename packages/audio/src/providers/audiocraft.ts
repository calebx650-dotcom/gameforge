import { ProviderError, type GenerationJob } from "@gameforge/shared";
import type { MusicGenerationProvider, MusicGenRequest, MusicGenResult } from "../music-generation.js";

export interface AudioCraftConfig {
  /** Base URL of a locally-running AudioCraft inference server (facebookresearch/audiocraft: MusicGen + AudioGen). */
  baseUrl?: string;
}

interface AudioCraftJobResponse {
  job_id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  progress?: number;
  error?: string;
  audio_url?: string;
  duration_seconds?: number;
}

/**
 * Local-first adapter for Meta's AudioCraft (MusicGen for music beds,
 * AudioGen for sound effects/ambience) — replaces a hosted
 * procedural-audio vendor with a model you run yourself. `kind` selects
 * which underlying AudioCraft model the local server should route to;
 * that routing decision lives server-side, not in this adapter.
 */
export class AudioCraftProvider implements MusicGenerationProvider {
  readonly id = "audiocraft";
  readonly displayName = "AudioCraft (local)";

  private readonly baseUrl: string;

  constructor(config: AudioCraftConfig = {}) {
    this.baseUrl = (config.baseUrl ?? "http://127.0.0.1:8003").replace(/\/$/, "");
  }

  async submitJob(request: MusicGenRequest): Promise<GenerationJob<MusicGenResult>> {
    const res = await this.fetch("/generate", {
      method: "POST",
      body: JSON.stringify({
        prompt: request.prompt,
        model: request.kind === "ambient_music" ? "musicgen" : "audiogen",
        duration_seconds: request.durationSeconds ?? (request.kind === "ambient_music" ? 30 : 3),
      }),
    });
    const data = (await res.json()) as AudioCraftJobResponse;
    return { id: data.job_id, status: mapStatus(data.status) };
  }

  async pollJob(jobId: string): Promise<GenerationJob<MusicGenResult>> {
    const res = await this.fetch(`/jobs/${encodeURIComponent(jobId)}`);
    const data = (await res.json()) as AudioCraftJobResponse;
    return {
      id: data.job_id,
      status: mapStatus(data.status),
      progress: data.progress,
      error: data.error,
      result: data.audio_url ? { audioUrl: data.audio_url, format: "wav", durationSeconds: data.duration_seconds } : undefined,
    };
  }

  private async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
    } catch (err) {
      throw new ProviderError(
        `Failed to reach local AudioCraft server at ${this.baseUrl} — is it running? (${(err as Error).message})`,
        true,
        err,
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ProviderError(`AudioCraft server returned ${res.status}: ${text}`, res.status >= 500);
    }
    return res;
  }
}

function mapStatus(status: AudioCraftJobResponse["status"]): GenerationJob["status"] {
  return status;
}
