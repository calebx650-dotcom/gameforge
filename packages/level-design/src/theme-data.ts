import type { LevelTheme } from "./types.js";

export interface ThemeData {
  entranceKind: string;
  finaleKind: string;
  roomKinds: string[];
  decorPrefabs: string[];
  roomSizeRange: { min: number; max: number };
}

export const THEME_DATA: Record<LevelTheme, ThemeData> = {
  gothic_cathedral: {
    entranceKind: "narthex",
    finaleKind: "sanctum",
    roomKinds: ["nave", "chapel", "crypt", "cloister", "bell_tower", "confessional"],
    decorPrefabs: [
      "prefab_gargoyle_statue",
      "prefab_candelabra",
      "prefab_blood_pool_decal",
      "prefab_stained_glass_window",
      "prefab_stone_coffin",
      "prefab_broken_pew",
    ],
    roomSizeRange: { min: 4, max: 10 },
  },
  urban_arena: {
    entranceKind: "back_alley",
    finaleKind: "rooftop_finale",
    roomKinds: ["alley", "parking_garage", "plaza", "subway_platform", "rooftop", "loading_dock"],
    decorPrefabs: [
      "prefab_dumpster",
      "prefab_neon_sign",
      "prefab_chain_link_fence",
      "prefab_graffiti_wall",
      "prefab_burning_barrel",
      "prefab_wrecked_car",
    ],
    roomSizeRange: { min: 5, max: 12 },
  },
  asylum_hallway: {
    entranceKind: "intake_ward",
    finaleKind: "morgue",
    roomKinds: ["cell_block", "day_room", "surgery_theater", "records_office", "boiler_room", "isolation_cell"],
    decorPrefabs: [
      "prefab_wheelchair",
      "prefab_gurney",
      "prefab_broken_mirror",
      "prefab_flickering_light_fixture",
      "prefab_padded_cell_door",
      "prefab_medical_cabinet",
    ],
    roomSizeRange: { min: 3, max: 8 },
  },
};
