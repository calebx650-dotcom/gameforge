import { describe, expect, it } from "vitest";
import { generatePostProcessingProfile } from "./post-processing.js";

describe("generatePostProcessingProfile", () => {
  it("is deterministic per theme", () => {
    expect(generatePostProcessingProfile("gothic_cathedral")).toEqual(generatePostProcessingProfile("gothic_cathedral"));
  });

  it("gives the asylum theme a heavier vignette and desaturation for a clinical-horror read", () => {
    const asylum = generatePostProcessingProfile("asylum_hallway");
    const urban = generatePostProcessingProfile("urban_arena");
    expect(asylum.vignette.intensity).toBeGreaterThan(urban.vignette.intensity);
    expect(asylum.colorGrading.saturation).toBeLessThan(urban.colorGrading.saturation);
  });

  it("gives the urban arena theme a cooler, more saturated neon look than the gothic theme", () => {
    const urban = generatePostProcessingProfile("urban_arena");
    const gothic = generatePostProcessingProfile("gothic_cathedral");
    expect(urban.colorGrading.saturation).toBeGreaterThan(gothic.colorGrading.saturation);
    expect(urban.chromaticAberration.intensity).toBeGreaterThan(gothic.chromaticAberration.intensity);
  });

  it("includes the theme on the returned profile", () => {
    expect(generatePostProcessingProfile("gothic_cathedral").theme).toBe("gothic_cathedral");
  });
});
