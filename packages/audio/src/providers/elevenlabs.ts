import { ProviderError, type GenerationJob } from "@gameforge/shared";
import type { VoiceProvider, VoiceRequest, VoiceResult, VoiceStyle } from "../voice.js";

export interface ElevenLabsConfig {
  apiKey: string;
  baseUrl?: string;
}

const STYLE_EXAGGERATION: Record<VoiceStyle, number> = {
  neutral: 0,
  whisper: 0.1,
  monologue: 0.3,
  growl: 0.7,
  scream: 0.9,
};

/**
 * Adapter for ElevenLabs text-to-speech. Unlike the 3D/motion vendors,
 * ElevenLabs returns audio bytes synchronously from a single request —
 * there's no job to poll. submitJob does the real work and returns an
 * already-"succeeded" job; pollJob just looks it back up.
 */
export class ElevenLabsProvider implements VoiceProvider {
  readonly id = "elevenlabs";
  readonly displayName = "ElevenLabs";

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly completedJobs = new Map<string, GenerationJob<VoiceResult>>();

  constructor(config: ElevenLabsConfig) {
    if (!config.apiKey) throw new ProviderError("ElevenLabs provider requires an API key");
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? "https://api.elevenlabs.io").replace(/\/$/, "");
  }

  async submitJob(request: VoiceRequest): Promise<GenerationJob<VoiceResult>> {
    const id = `elevenlabs-${Date.now()}`;
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/v1/text-to-speech/${encodeURIComponent(request.voiceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "xi-api-key": this.apiKey },
        body: JSON.stringify({
          text: request.text,
          voice_settings: {
            stability: request.stability ?? 0.5,
            similarity_boost: request.similarityBoost ?? 0.75,
            style: STYLE_EXAGGERATION[request.style ?? "neutral"],
          },
        }),
      });
    } catch (err) {
      const job: GenerationJob<VoiceResult> = { id, status: "failed", error: `Failed to reach ElevenLabs: ${(err as Error).message}` };
      this.completedJobs.set(id, job);
      return job;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const job: GenerationJob<VoiceResult> = { id, status: "failed", error: `ElevenLabs request failed (${res.status}): ${text}` };
      this.completedJobs.set(id, job);
      return job;
    }

    const bytes = new Uint8Array(await res.arrayBuffer());
    const audioUrl = `data:audio/mpeg;base64,${Buffer.from(bytes).toString("base64")}`;
    const job: GenerationJob<VoiceResult> = { id, status: "succeeded", result: { audioUrl, format: "mp3" } };
    this.completedJobs.set(id, job);
    return job;
  }

  async pollJob(jobId: string): Promise<GenerationJob<VoiceResult>> {
    const job = this.completedJobs.get(jobId);
    if (!job) throw new ProviderError(`Unknown generation job: ${jobId}`);
    return job;
  }
}
