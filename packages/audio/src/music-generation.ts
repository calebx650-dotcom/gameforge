import type { GenerationJob } from "@gameforge/shared";

export type AudioClipKind = "ambient_music" | "sound_effect";

export interface MusicGenRequest {
  prompt: string;
  kind: AudioClipKind;
  durationSeconds?: number;
}

export interface MusicGenResult {
  audioUrl: string;
  format: "wav" | "mp3";
  durationSeconds?: number;
}

/**
 * Behind this interface: any local text-to-audio model capable of
 * generating either music beds or one-shot sound effects from a prompt —
 * distinct from `VoiceProvider`, which is specifically speech/dialogue.
 * `AudioCraftProvider` (Meta's MusicGen/AudioGen) is the reference
 * implementation; a future vendor just implements this interface.
 */
export interface MusicGenerationProvider {
  readonly id: string;
  readonly displayName: string;
  submitJob(request: MusicGenRequest): Promise<GenerationJob<MusicGenResult>>;
  pollJob(jobId: string): Promise<GenerationJob<MusicGenResult>>;
}
