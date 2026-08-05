import { describe, expect, it } from "vitest";
import { generateLevel } from "./generator.js";
import { generateLightingPlan } from "./lighting.js";

describe("generateLightingPlan", () => {
  it("is deterministic for the same layout", () => {
    const { layout } = generateLevel({ theme: "asylum_hallway", seed: 9, roomCount: 6 });
    const a = generateLightingPlan(layout);
    const b = generateLightingPlan(layout);
    expect(a).toEqual(b);
  });

  it("places at least one light per room and uses the theme's palette", () => {
    const { layout } = generateLevel({ theme: "urban_arena", seed: 4, roomCount: 5 });
    const plan = generateLightingPlan(layout);

    const roomsWithLight = new Set(plan.lights.map((l) => l.roomId));
    expect(roomsWithLight.size).toBe(layout.rooms.length);

    for (const light of plan.lights) {
      expect(["point", "spot", "area"]).toContain(light.type);
      expect(light.colorHex).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("gives the asylum theme a high flicker rate to read as unsettling, not a steady well-lit ward", () => {
    const { layout } = generateLevel({ theme: "asylum_hallway", seed: 100, roomCount: 20 });
    const plan = generateLightingPlan(layout);
    const flickerRatio = plan.lights.filter((l) => l.flicker).length / plan.lights.length;
    expect(flickerRatio).toBeGreaterThan(0.3);
  });
});
