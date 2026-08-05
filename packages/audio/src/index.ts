export type { VoiceProvider, VoiceRequest, VoiceResult, VoiceStyle } from "./voice.js";
export { ElevenLabsProvider } from "./providers/elevenlabs.js";
export { KokoroProvider } from "./providers/kokoro.js";
export { XTTSProvider } from "./providers/xtts.js";
export { AudioCraftProvider } from "./providers/audiocraft.js";
export type { MusicGenerationProvider, MusicGenRequest, MusicGenResult, AudioClipKind } from "./music-generation.js";
export {
  createVoiceProvider,
  createMusicGenerationProvider,
  SUPPORTED_VOICE_PROVIDERS,
  SUPPORTED_MUSIC_GENERATION_PROVIDERS,
} from "./registry.js";
export type { VoiceSettings } from "./registry.js";
export { generateSoundscape } from "./soundscape.js";
export type { AmbientCue, SoundscapePlan } from "./soundscape.js";
export { computeMusicMix } from "./music-intensity.js";
export type { MusicLayer, MusicMixEntry } from "./music-intensity.js";
