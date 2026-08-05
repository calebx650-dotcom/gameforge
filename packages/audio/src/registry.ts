import { ProviderError } from "@gameforge/shared";
import type { VoiceProvider } from "./voice.js";
import type { MusicGenerationProvider } from "./music-generation.js";
import { ElevenLabsProvider } from "./providers/elevenlabs.js";
import { KokoroProvider } from "./providers/kokoro.js";
import { XTTSProvider } from "./providers/xtts.js";
import { AudioCraftProvider } from "./providers/audiocraft.js";

export interface VoiceSettings {
  provider: string;
  apiKey?: string;
  baseUrl?: string;
}

export function createVoiceProvider(settings: VoiceSettings): VoiceProvider {
  switch (settings.provider) {
    case "elevenlabs":
      return new ElevenLabsProvider({ apiKey: settings.apiKey ?? "", baseUrl: settings.baseUrl });
    case "kokoro":
      return new KokoroProvider({ baseUrl: settings.baseUrl });
    case "xtts":
      return new XTTSProvider({ baseUrl: settings.baseUrl });
    default:
      throw new ProviderError(`Unknown voice provider: ${settings.provider}`);
  }
}

export function createMusicGenerationProvider(settings: VoiceSettings): MusicGenerationProvider {
  switch (settings.provider) {
    case "audiocraft":
      return new AudioCraftProvider({ baseUrl: settings.baseUrl });
    default:
      throw new ProviderError(`Unknown music generation provider: ${settings.provider}`);
  }
}

export const SUPPORTED_VOICE_PROVIDERS = ["elevenlabs", "kokoro", "xtts"] as const;
export const SUPPORTED_MUSIC_GENERATION_PROVIDERS = ["audiocraft"] as const;
