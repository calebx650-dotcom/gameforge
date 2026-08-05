import { createRng, pick } from "./rng.js";
import type { LevelLayout, LevelTheme } from "./types.js";

export type LightType = "point" | "spot" | "area";

export interface LightPlacement {
  roomId: string;
  type: LightType;
  position: { x: number; y: number; z: number };
  colorHex: string;
  intensity: number;
  flicker: boolean;
}

export interface LightingPlan {
  theme: LevelTheme;
  ambientColorHex: string;
  lights: LightPlacement[];
}

interface MoodPalette {
  ambientColorHex: string;
  accentColors: string[];
  flickerChance: number;
  lightsPerRoomRange: [number, number];
}

const MOOD_PALETTES: Record<LevelTheme, MoodPalette> = {
  gothic_cathedral: {
    ambientColorHex: "#1a1420",
    accentColors: ["#7a5a2e", "#8a1f1f", "#b8860b"],
    flickerChance: 0.35,
    lightsPerRoomRange: [1, 2],
  },
  urban_arena: {
    ambientColorHex: "#0d1420",
    accentColors: ["#00e5ff", "#ff2d55", "#f5f500"],
    flickerChance: 0.5,
    lightsPerRoomRange: [2, 3],
  },
  asylum_hallway: {
    ambientColorHex: "#141414",
    accentColors: ["#c8d8d8", "#5fae5f", "#c8c8a0"],
    flickerChance: 0.6,
    lightsPerRoomRange: [1, 1],
  },
};

/**
 * Generates a deterministic per-room lighting plan tuned for horror/action
 * atmosphere: dim ambient plus one or more accent lights per room, with a
 * theme-appropriate flicker chance (a steady, well-lit asylum ward reads
 * wrong — flickering fluorescents read right). This is the data a future
 * Unity bridge command would use to actually create Light components;
 * GameForge computes the plan today without needing Unity present.
 */
export function generateLightingPlan(layout: LevelLayout): LightingPlan {
  const palette = MOOD_PALETTES[layout.theme];
  const rng = createRng(layout.seed ^ 0x4c49_4748); // distinct stream from the level-geometry rng

  const lights: LightPlacement[] = [];
  for (const room of layout.rooms) {
    const count = intBetween(rng, palette.lightsPerRoomRange[0], palette.lightsPerRoomRange[1]);
    for (let i = 0; i < count; i++) {
      lights.push({
        roomId: room.id,
        type: pick(rng, ["point", "spot", "area"] as const),
        position: {
          x: room.position.x + room.width / 2,
          y: 2.5,
          z: room.position.y + room.height / 2,
        },
        colorHex: pick(rng, palette.accentColors),
        intensity: 0.6 + rng() * 0.8,
        flicker: rng() < palette.flickerChance,
      });
    }
  }

  return { theme: layout.theme, ambientColorHex: palette.ambientColorHex, lights };
}

function intBetween(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}
