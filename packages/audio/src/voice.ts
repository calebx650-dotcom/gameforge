import type { GenerationJob } from "@gameforge/shared";

export type VoiceStyle = "neutral" | "scream" | "whisper" | "monologue" | "growl";

export interface VoiceRequest {
  text: string;
  voiceId: string;
  style?: VoiceStyle;
  stability?: number;
  similarityBoost?: number;
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
