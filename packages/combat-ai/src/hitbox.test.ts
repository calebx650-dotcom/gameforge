import { describe, expect, it } from "vitest";
import { bindHitboxToAnimation, validateHitboxFrames } from "./hitbox.js";

describe("bindHitboxToAnimation", () => {
  it("uses the default 20%/40% startup/active split", () => {
    const frame = bindHitboxToAnimation("slash", { totalFrames: 60, frameRate: 30 });
    expect(frame).toMatchObject({ startFrame: 12, endFrame: 24, shape: "capsule", boneAttachment: "weapon_tip" });
  });

  it("respects overrides", () => {
    const frame = bindHitboxToAnimation("stomp", { totalFrames: 100, frameRate: 30 }, { shape: "sphere", boneAttachment: "foot_r", startFraction: 0.5, endFraction: 0.6 });
    expect(frame).toMatchObject({ startFrame: 50, endFrame: 60, shape: "sphere", boneAttachment: "foot_r" });
  });

  it("throws on an invalid fraction window", () => {
    expect(() => bindHitboxToAnimation("x", { totalFrames: 60, frameRate: 30 }, { startFraction: 0.5, endFraction: 0.3 })).toThrow(/Invalid hitbox window/);
  });
});

describe("validateHitboxFrames", () => {
  it("passes for non-overlapping, in-range frames", () => {
    const frames = [
      bindHitboxToAnimation("slash", { totalFrames: 60, frameRate: 30 }),
      bindHitboxToAnimation("stomp", { totalFrames: 60, frameRate: 30 }, { startFraction: 0.5, endFraction: 0.7 }),
    ];
    expect(validateHitboxFrames(frames, 60)).toEqual([]);
  });

  it("flags a frame range outside the clip length", () => {
    const frames = [{ attackName: "slash", startFrame: 10, endFrame: 70, shape: "capsule" as const, boneAttachment: "hand" }];
    const errors = validateHitboxFrames(frames, 60);
    expect(errors.some((e) => e.includes("outside clip length"))).toBe(true);
  });

  it("flags startFrame >= endFrame", () => {
    const frames = [{ attackName: "slash", startFrame: 30, endFrame: 30, shape: "capsule" as const, boneAttachment: "hand" }];
    expect(validateHitboxFrames(frames, 60).some((e) => e.includes("must be before"))).toBe(true);
  });

  it("flags two overlapping hitbox windows for the same attack", () => {
    const frames = [
      { attackName: "slash", startFrame: 10, endFrame: 20, shape: "capsule" as const, boneAttachment: "hand" },
      { attackName: "slash", startFrame: 15, endFrame: 25, shape: "capsule" as const, boneAttachment: "hand" },
    ];
    expect(validateHitboxFrames(frames, 60).some((e) => e.includes("overlapping"))).toBe(true);
  });

  it("does not flag overlapping windows belonging to different attacks", () => {
    const frames = [
      { attackName: "slash", startFrame: 10, endFrame: 20, shape: "capsule" as const, boneAttachment: "hand" },
      { attackName: "stomp", startFrame: 15, endFrame: 25, shape: "capsule" as const, boneAttachment: "foot" },
    ];
    expect(validateHitboxFrames(frames, 60)).toEqual([]);
  });
});
