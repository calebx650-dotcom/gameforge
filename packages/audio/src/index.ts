export type { VoiceProvider, VoiceRequest, VoiceResult, VoiceStyle } from "./voice.js";
export { ElevenLabsProvider } from "./providers/elevenlabs.js";
export { createVoiceProvider, SUPPORTED_VOICE_PROVIDERS } from "./registry.js";
export type { VoiceSettings } from "./registry.js";
export { generateSoundscape } from "./soundscape.js";
export type { AmbientCue, SoundscapePlan } from "./soundscape.js";
export { computeMusicMix } from "./music-intensity.js";
export type { MusicLayer, MusicMixEntry } from "./music-intensity.js";
