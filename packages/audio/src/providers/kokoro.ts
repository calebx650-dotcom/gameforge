import { ProviderError, type GenerationJob } from "@gameforge/shared";
import type { VoiceProvider, VoiceRequest, VoiceResult } from "../voice.js";

export interface KokoroConfig {
  /** Base URL of a locally-running Kokoro-FastAPI server (hexgrad/kokoro), which mirrors OpenAI's /v1/audio/speech shape. */
  baseUrl?: string;
}

/**
 * Local-first adapter for Kokoro (hexgrad/kokoro) via the community
 * Kokoro-FastAPI wrapper, which intentionally mirrors OpenAI's
 * `/v1/audio/speech` request/response shape. Kokoro is a tiny (82M
 * parameter) model that synthesizes studio-quality speech in
 * milliseconds on a single consumer GPU — no ElevenLabs account, no
 * per-character cost, no network round-trip beyond localhost.
 */
export class KokoroProvider implements VoiceProvider {
  readonly id = "kokoro";
  readonly displayName = "Kokoro (local)";

  private readonly baseUrl: string;
  private readonly completedJobs = new Map<string, GenerationJob<VoiceResult>>();

  constructor(config: KokoroConfig = {}) {
    this.baseUrl = (config.baseUrl ?? "http://127.0.0.1:8880").replace(/\/$/, "");
  }

  async submitJob(request: VoiceRequest): Promise<GenerationJob<VoiceResult>> {
    const id = `kokoro-${Date.now()}`;
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/v1/audio/speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "kokoro", input: request.text, voice: request.voiceId, response_format: "mp3" }),
      });
    } catch (err) {
      const job: GenerationJob<VoiceResult> = {
        id,
        status: "failed",
        error: `Failed to reach local Kokoro server at ${this.baseUrl} — is it running? (${(err as Error).message})`,
      };
      this.completedJobs.set(id, job);
      return job;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const job: GenerationJob<VoiceResult> = { id, status: "failed", error: `Kokoro server returned ${res.status}: ${text}` };
      this.completedJobs.set(id, job);
      return job;
    }

    const bytes = new Uint8Array(await res.arrayBuffer());
    const job: GenerationJob<VoiceResult> = {
      id,
      status: "succeeded",
      result: { audioUrl: `data:audio/mpeg;base64,${Buffer.from(bytes).toString("base64")}`, format: "mp3" },
    };
    this.completedJobs.set(id, job);
    return job;
  }

  async pollJob(jobId: string): Promise<GenerationJob<VoiceResult>> {
    const job = this.completedJobs.get(jobId);
    if (!job) throw new ProviderError(`Unknown generation job: ${jobId}`);
    return job;
  }
}
