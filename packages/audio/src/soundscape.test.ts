import { describe, expect, it } from "vitest";
import { generateLevel } from "@gameforge/level-design";
import { generateSoundscape } from "./soundscape.js";

describe("generateSoundscape", () => {
  it("is deterministic for the same layout", () => {
    const { layout } = generateLevel({ theme: "urban_arena", seed: 6, roomCount: 6 });
    expect(generateSoundscape(layout)).toEqual(generateSoundscape(layout));
  });

  it("gives every room at least an ambient loop cue", () => {
    const { layout } = generateLevel({ theme: "gothic_cathedral", seed: 3, roomCount: 5 });
    const plan = generateSoundscape(layout);
    const roomsWithAmbient = new Set(plan.cues.filter((c) => c.kind === "ambient_loop").map((c) => c.roomId));
    expect(roomsWithAmbient.size).toBe(layout.rooms.length);
  });

  it("uses a theme-appropriate ambient bed and cue assets", () => {
    const { layout } = generateLevel({ theme: "asylum_hallway", seed: 8, roomCount: 4 });
    const plan = generateSoundscape(layout);
    expect(plan.ambientBedAssetId).toContain("asylum");
    for (const cue of plan.cues) {
      expect(cue.assetId).toBeTruthy();
      expect(cue.volume).toBeGreaterThan(0);
      expect(cue.spatialRadius).toBeGreaterThan(0);
    }
  });
});
