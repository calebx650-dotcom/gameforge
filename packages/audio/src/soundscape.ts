import { createRng, intBetween, pick } from "@gameforge/level-design";
import type { LevelLayout, LevelTheme } from "@gameforge/level-design";

export interface AmbientCue {
  roomId: string;
  kind: "ambient_loop" | "impact_stinger";
  assetId: string;
  volume: number;
  spatialRadius: number;
}

export interface SoundscapePlan {
  theme: LevelTheme;
  ambientBedAssetId: string;
  cues: AmbientCue[];
}

interface ThemeAudio {
  ambientBed: string;
  roomAmbientLoops: string[];
  impactStingers: string[];
}

const THEME_AUDIO: Record<LevelTheme, ThemeAudio> = {
  gothic_cathedral: {
    ambientBed: "audio_bed_gothic_choir_drone",
    roomAmbientLoops: ["audio_loop_distant_organ", "audio_loop_dripping_water", "audio_loop_wind_through_stone", "audio_loop_candle_crackle"],
    impactStingers: ["audio_sfx_metallic_clang", "audio_sfx_blood_splatter", "audio_sfx_stone_crumble"],
  },
  urban_arena: {
    ambientBed: "audio_bed_urban_night_drone",
    roomAmbientLoops: ["audio_loop_distant_traffic", "audio_loop_neon_hum", "audio_loop_rain_on_metal", "audio_loop_police_siren_far"],
    impactStingers: ["audio_sfx_metal_dumpster_hit", "audio_sfx_glass_shatter", "audio_sfx_car_alarm"],
  },
  asylum_hallway: {
    ambientBed: "audio_bed_asylum_low_drone",
    roomAmbientLoops: ["audio_loop_distant_screaming", "audio_loop_flickering_fluorescent", "audio_loop_dripping_pipe", "audio_loop_muffled_pounding"],
    impactStingers: ["audio_sfx_gurney_squeak", "audio_sfx_glass_break", "audio_sfx_metal_door_slam"],
  },
};

/**
 * Generates a deterministic per-room ambient soundscape for a generated
 * level: one shared ambient "bed" for the whole level plus a room-level
 * ambient loop and a spatial impact-stinger pool per room, themed to match
 * the level's horror/action tone. Reuses the same seeded-RNG approach as
 * @gameforge/level-design's lighting plan for reproducibility.
 */
export function generateSoundscape(layout: LevelLayout): SoundscapePlan {
  const audio = THEME_AUDIO[layout.theme];
  const rng = createRng(layout.seed ^ 0x5341_5544); // distinct stream ("SAUD")

  const cues: AmbientCue[] = [];
  for (const room of layout.rooms) {
    cues.push({
      roomId: room.id,
      kind: "ambient_loop",
      assetId: pick(rng, audio.roomAmbientLoops),
      volume: 0.4 + rng() * 0.3,
      spatialRadius: Math.max(room.width, room.height) * 0.75,
    });

    const stingerCount = intBetween(rng, 0, 2);
    for (let i = 0; i < stingerCount; i++) {
      cues.push({
        roomId: room.id,
        kind: "impact_stinger",
        assetId: pick(rng, audio.impactStingers),
        volume: 0.6 + rng() * 0.4,
        spatialRadius: Math.max(room.width, room.height) * 0.5,
      });
    }
  }

  return { theme: layout.theme, ambientBedAssetId: audio.ambientBed, cues };
}
