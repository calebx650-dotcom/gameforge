import { describe, expect, it } from "vitest";
import { computeMusicMix, type MusicLayer } from "./music-intensity.js";

const layers: MusicLayer[] = [
  { id: "exploration", name: "Exploration", activationThreshold: 0 },
  { id: "tension", name: "Tension", activationThreshold: 0.35 },
  { id: "combat", name: "Combat", activationThreshold: 0.65 },
  { id: "climax", name: "Climax", activationThreshold: 0.9 },
];

describe("computeMusicMix", () => {
  it("plays only the exploration layer at zero intensity", () => {
    const mix = computeMusicMix(0, layers);
    expect(mix.find((m) => m.layerId === "exploration")!.volume).toBe(1);
    expect(mix.find((m) => m.layerId === "climax")!.volume).toBe(0);
  });

  it("crossfades smoothly through a layer's activation window instead of hard-cutting", () => {
    const beforeWindow = computeMusicMix(0.19, layers).find((m) => m.layerId === "tension")!.volume;
    const midWindow = computeMusicMix(0.3, layers).find((m) => m.layerId === "tension")!.volume;
    const at = computeMusicMix(0.35, layers).find((m) => m.layerId === "tension")!.volume;
    const after = computeMusicMix(0.5, layers).find((m) => m.layerId === "tension")!.volume;
    expect(beforeWindow).toBe(0);
    expect(midWindow).toBeGreaterThan(0);
    expect(midWindow).toBeLessThan(1);
    expect(at).toBe(1);
    expect(after).toBe(1);
  });

  it("brings in every layer at full intensity", () => {
    const mix = computeMusicMix(1, layers);
    for (const entry of mix) {
      expect(entry.volume).toBe(1);
    }
  });

  it("clamps out-of-range intensity instead of producing invalid volumes", () => {
    const tooHigh = computeMusicMix(5, layers);
    const tooLow = computeMusicMix(-5, layers);
    expect(tooHigh.every((m) => m.volume === 1)).toBe(true);
    expect(tooLow.find((m) => m.layerId === "exploration")!.volume).toBe(1);
    expect(tooLow.find((m) => m.layerId === "climax")!.volume).toBe(0);
  });
});
