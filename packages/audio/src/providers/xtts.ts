import { ProviderError, type GenerationJob } from "@gameforge/shared";
import type { VoiceProvider, VoiceRequest, VoiceResult } from "../voice.js";

export interface XTTSConfig {
  /** Base URL of a locally-running Coqui TTS server (coqui-ai/TTS, XTTS-v2 model). */
  baseUrl?: string;
}

/**
 * Local-first adapter for Coqui's XTTS-v2 (coqui-ai/TTS) — the best
 * open-source option for zero-shot voice cloning: give it a few seconds
 * of reference audio (`referenceAudioUrl`) and it clones that voice for
 * arbitrary new lines, entirely on your own GPU. This is the natural
 * local substitute for ElevenLabs' voice-cloning tier specifically —
 * `KokoroProvider` covers the fixed-voice-library use case faster and
 * lighter-weight, XTTS-v2 covers "clone this specific NPC's voice."
 */
export class XTTSProvider implements VoiceProvider {
  readonly id = "xtts";
  readonly displayName = "Coqui XTTS-v2 (local)";

  private readonly baseUrl: string;
  private readonly completedJobs = new Map<string, GenerationJob<VoiceResult>>();

  constructor(config: XTTSConfig = {}) {
    this.baseUrl = (config.baseUrl ?? "http://127.0.0.1:5002").replace(/\/$/, "");
  }

  async submitJob(request: VoiceRequest): Promise<GenerationJob<VoiceResult>> {
    if (!request.referenceAudioUrl) {
      throw new ProviderError("XTTS-v2 clones a voice from reference audio — request.referenceAudioUrl is required.");
    }
    const id = `xtts-${Date.now()}`;
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: request.text, speaker_wav: request.referenceAudioUrl, language: request.language ?? "en" }),
      });
    } catch (err) {
      const job: GenerationJob<VoiceResult> = {
        id,
        status: "failed",
        error: `Failed to reach local XTTS server at ${this.baseUrl} — is it running? (${(err as Error).message})`,
      };
      this.completedJobs.set(id, job);
      return job;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const job: GenerationJob<VoiceResult> = { id, status: "failed", error: `XTTS server returned ${res.status}: ${text}` };
      this.completedJobs.set(id, job);
      return job;
    }

    const bytes = new Uint8Array(await res.arrayBuffer());
    const job: GenerationJob<VoiceResult> = {
      id,
      status: "succeeded",
      result: { audioUrl: `data:audio/wav;base64,${Buffer.from(bytes).toString("base64")}`, format: "wav" },
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
