import { describe, expect, it } from "vitest";
import { generateAtmosphericFogShader, generateGrimeOverlayShader, generateNightVisionPostProcessShader } from "./hlsl-generators.js";

describe("generateAtmosphericFogShader", () => {
  it("produces a valid ShaderLab skeleton with substituted parameters", () => {
    const shader = generateAtmosphericFogShader({ shaderName: "Test/Fog", density: 0.2, heightFalloff: 0.3 });
    expect(shader).toContain('Shader "Test/Fog"');
    expect(shader).toContain("_FogDensity");
    expect(shader).toContain("Range(0, 1)) = 0.2");
    expect(shader).toContain("Range(0, 1)) = 0.3");
    expect(shader).toContain("HLSLPROGRAM");
    expect(shader).toContain("ENDHLSL");
  });

  it("converts a hex color into normalized 0-1 RGB floats", () => {
    const shader = generateAtmosphericFogShader({ colorHex: "#ff0000" });
    expect(shader).toContain("_FogColor (\"Fog Color\", Color) = (1, 0, 0, 1)");
  });
});

describe("generateGrimeOverlayShader", () => {
  it("wires the custom grime texture name through properties and the surface function", () => {
    const shader = generateGrimeOverlayShader({ grimeTextureName: "_BloodMask" });
    expect(shader).toContain("_BloodMask");
    expect(shader).toContain("surf(Input IN, inout SurfaceOutputStandard o)");
    expect(shader).toContain("lerp(base.rgb, grime.rgb, wearMask)");
  });
});

describe("generateNightVisionPostProcessShader", () => {
  it("includes noise and vignette terms driven by the given parameters", () => {
    const shader = generateNightVisionPostProcessShader({ noiseIntensity: 0.5, vignetteStrength: 0.9 });
    expect(shader).toContain("Range(0, 1)) = 0.5");
    expect(shader).toContain("Range(0, 1)) = 0.9");
    expect(shader).toContain("rand(");
    expect(shader).toContain("vignette");
  });
});
