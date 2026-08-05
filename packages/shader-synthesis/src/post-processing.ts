import type { LevelTheme } from "@gameforge/level-design";

export interface PostProcessingProfile {
  theme: LevelTheme;
  bloom: { intensity: number; threshold: number; tintHex: string };
  vignette: { intensity: number; smoothness: number; colorHex: string };
  colorGrading: { temperature: number; tint: number; saturation: number; contrast: number };
  fog: { colorHex: string; density: number };
  filmGrain: { intensity: number };
  chromaticAberration: { intensity: number };
}

interface ThemeProfile extends Omit<PostProcessingProfile, "theme"> {}

/**
 * Deterministic, theme-tuned Unity Volume profile settings (URP/HDRP
 * Volume component values) — the atmosphere layer that makes a graybox
 * level actually read as Bloodborne-gothic, DMC-neon-urban, or
 * Outlast-clinical-horror, on top of the lighting plan already generated
 * by @gameforge/level-design. Pure data — the future Unity bridge writes
 * these values onto an actual VolumeProfile asset.
 */
const THEME_PROFILES: Record<LevelTheme, ThemeProfile> = {
  gothic_cathedral: {
    bloom: { intensity: 0.6, threshold: 1.1, tintHex: "#d4af37" },
    vignette: { intensity: 0.45, smoothness: 0.6, colorHex: "#0a0608" },
    colorGrading: { temperature: -8, tint: 4, saturation: -20, contrast: 15 },
    fog: { colorHex: "#3a2f38", density: 0.05 },
    filmGrain: { intensity: 0.25 },
    chromaticAberration: { intensity: 0.15 },
  },
  urban_arena: {
    bloom: { intensity: 0.9, threshold: 0.9, tintHex: "#00e5ff" },
    vignette: { intensity: 0.35, smoothness: 0.5, colorHex: "#050510" },
    colorGrading: { temperature: -15, tint: 8, saturation: 10, contrast: 25 },
    fog: { colorHex: "#101822", density: 0.03 },
    filmGrain: { intensity: 0.15 },
    chromaticAberration: { intensity: 0.3 },
  },
  asylum_hallway: {
    bloom: { intensity: 0.3, threshold: 1.3, tintHex: "#c8d8c8" },
    vignette: { intensity: 0.6, smoothness: 0.4, colorHex: "#000000" },
    colorGrading: { temperature: -5, tint: -10, saturation: -40, contrast: 20 },
    fog: { colorHex: "#1a1a1a", density: 0.02 },
    filmGrain: { intensity: 0.4 },
    chromaticAberration: { intensity: 0.1 },
  },
};

export function generatePostProcessingProfile(theme: LevelTheme): PostProcessingProfile {
  return { theme, ...THEME_PROFILES[theme] };
}
