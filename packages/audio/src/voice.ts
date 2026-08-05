import type { GenerationJob } from "@gameforge/shared";

export type VoiceStyle = "neutral" | "scream" | "whisper" | "monologue" | "growl";

export interface VoiceRequest {
  text: string;
  voiceId: string;
  style?: VoiceStyle;
  stability?: number;
  similarityBoost?: number;
  /**
   * Optional reference audio (URL or data: URI) for zero-shot voice
   * cloning vendors like Coqui XTTS-v2. Vendors that use a fixed voice
   * library (ElevenLabs, Kokoro) ignore this and use `voiceId` instead.
   */
  referenceAudioUrl?: string;
  /** BCP-47 language code, for multilingual local models. Defaults to "en". */
  language?: string;
}

export interface VoiceResult {
  /** Either a hosted URL or a data: URI, depending on the vendor's response shape. */
  audioUrl: string;
  format: "mp3" | "wav";
}

/**
 * Behind this interface: any AI voice vendor (ElevenLabs today; future
 * vendors need only implement this and register in the factory). Voice
 * synthesis is synchronous for most vendors (ElevenLabs returns audio
 * bytes directly), but the interface still uses the submit/poll job shape
 * so a future async/voice-cloning vendor fits without an interface change
 * — a synchronous provider just returns an already-"succeeded" job from
 * submitJob and echoes it back from pollJob.
 */
export interface VoiceProvider {
  readonly id: string;
  readonly displayName: string;
  submitJob(request: VoiceRequest): Promise<GenerationJob<VoiceResult>>;
  pollJob(jobId: string): Promise<GenerationJob<VoiceResult>>;
}
