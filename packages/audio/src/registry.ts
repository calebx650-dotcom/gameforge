import { ProviderError } from "@gameforge/shared";
import type { VoiceProvider } from "./voice.js";
import { ElevenLabsProvider } from "./providers/elevenlabs.js";

export interface VoiceSettings {
  provider: string;
  apiKey?: string;
  baseUrl?: string;
}

export function createVoiceProvider(settings: VoiceSettings): VoiceProvider {
  switch (settings.provider) {
    case "elevenlabs":
      return new ElevenLabsProvider({ apiKey: settings.apiKey ?? "", baseUrl: settings.baseUrl });
    default:
      throw new ProviderError(`Unknown voice provider: ${settings.provider}`);
  }
}

export const SUPPORTED_VOICE_PROVIDERS = ["elevenlabs"] as const;
