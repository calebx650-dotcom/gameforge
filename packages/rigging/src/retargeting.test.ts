import { describe, expect, it } from "vitest";
import {
  generateHumanoidAvatarMapping,
  generateLocomotionAnimatorController,
  generateRagdollConfig,
  generateRootMotionConfig,
} from "./retargeting.js";

describe("generateHumanoidAvatarMapping", () => {
  it("maps Mixamo-style bone names to Humanoid slots and validates as complete", () => {
    const bones = [
      "mixamorig:Hips",
      "mixamorig:Spine",
      "mixamorig:Head",
      "mixamorig:LeftShoulder",
      "mixamorig:LeftForeArm",
      "mixamorig:LeftHand",
      "mixamorig:RightShoulder",
      "mixamorig:RightForeArm",
      "mixamorig:RightHand",
      "mixamorig:LeftUpLeg",
      "mixamorig:LeftLeg",
      "mixamorig:LeftFoot",
      "mixamorig:RightUpLeg",
      "mixamorig:RightLeg",
      "mixamorig:RightFoot",
    ];
    const mapping = generateHumanoidAvatarMapping(bones);
    expect(mapping.isValid).toBe(true);
    expect(mapping.unmappedRequiredSlots).toEqual([]);
    expect(mapping.boneMap.Hips).toBe("mixamorig:Hips");
    expect(mapping.boneMap.LeftLowerArm).toBe("mixamorig:LeftForeArm");
    expect(mapping.boneMap.LeftUpperArm).toBe("mixamorig:LeftShoulder");
  });

  it("maps plain bone names without a mixamorig prefix", () => {
    const mapping = generateHumanoidAvatarMapping(["Hips", "Spine", "Head", "LeftUpperArm", "LeftLowerArm", "LeftHand"]);
    expect(mapping.boneMap.Spine).toBe("Spine");
    expect(mapping.boneMap.LeftUpperArm).toBe("LeftUpperArm");
  });

  it("never assigns the same source bone to two different Humanoid slots", () => {
    const mapping = generateHumanoidAvatarMapping(["Hips", "Spine2"]);
    const assignedBones = Object.values(mapping.boneMap);
    expect(new Set(assignedBones).size).toBe(assignedBones.length);
    expect(mapping.boneMap.Chest).toBe("Spine2");
    expect(mapping.boneMap.Spine).toBeUndefined();
  });

  it("reports missing required slots and marks the mapping invalid", () => {
    const mapping = generateHumanoidAvatarMapping(["Hips", "Head"]);
    expect(mapping.isValid).toBe(false);
    expect(mapping.unmappedRequiredSlots).toContain("LeftHand");
  });
});

describe("generateLocomotionAnimatorController", () => {
  it("builds a Locomotion blend tree keyed by Speed", () => {
    const controller = generateLocomotionAnimatorController();
    const locomotion = controller.states.find((s) => s.name === "Locomotion")!;
    expect(locomotion.blendTree?.parameter).toBe("Speed");
    expect(locomotion.blendTree?.entries.map((e) => e.motion)).toEqual(["Idle", "Walk", "Run"]);
    expect(controller.defaultState).toBe("Locomotion");
  });

  it("creates one state per attack clip with entry and exit transitions", () => {
    const controller = generateLocomotionAnimatorController({ attackClips: ["Slash", "Overhead"] });
    expect(controller.states.some((s) => s.name === "Attack_0" && s.motion === "Slash")).toBe(true);
    expect(controller.states.some((s) => s.name === "Attack_1" && s.motion === "Overhead")).toBe(true);

    const entryTransition = controller.transitions.find((t) => t.from === "Locomotion" && t.to === "Attack_1");
    expect(entryTransition?.conditions).toEqual([
      { parameter: "Attack", mode: "trigger" },
      { parameter: "AttackIndex", mode: "equals", threshold: 1 },
    ]);

    const exitTransition = controller.transitions.find((t) => t.from === "Attack_1" && t.to === "Locomotion");
    expect(exitTransition?.hasExitTime).toBe(true);
  });

  it("lets every state interrupt into HitReaction and always returns to Locomotion", () => {
    const controller = generateLocomotionAnimatorController({ attackClips: ["Slash"] });
    const hitFromLocomotion = controller.transitions.find((t) => t.from === "Locomotion" && t.to === "HitReaction");
    expect(hitFromLocomotion?.conditions).toEqual([{ parameter: "Hit", mode: "trigger" }]);
    const backToLocomotion = controller.transitions.find((t) => t.from === "HitReaction" && t.to === "Locomotion");
    expect(backToLocomotion?.hasExitTime).toBe(true);
  });
});

describe("generateRagdollConfig", () => {
  it("generates a joint config per non-root bone using limb-appropriate presets", () => {
    const mapping = generateHumanoidAvatarMapping([
      "Hips", "Spine", "Head",
      "LeftUpperArm", "LeftLowerArm", "LeftHand",
      "RightUpperArm", "RightLowerArm", "RightHand",
      "LeftUpperLeg", "LeftLowerLeg", "LeftFoot",
      "RightUpperLeg", "RightLowerLeg", "RightFoot",
    ]);
    const configs = generateRagdollConfig(mapping.boneMap);

    expect(configs.some((c) => c.boneName === "Hips")).toBe(false); // root carries no joint
    const head = configs.find((c) => c.boneName === "Head")!;
    expect(head.colliderShape).toBe("sphere");
    const lowerLeg = configs.find((c) => c.boneName === "LeftLowerLeg")!;
    expect(lowerLeg.angularZLimitDegrees.max).toBe(0); // knees don't hyperextend
    expect(lowerLeg.angularZLimitDegrees.min).toBeLessThan(0);
  });
});

describe("generateRootMotionConfig", () => {
  it("applies root motion for locomotion clips", () => {
    expect(generateRootMotionConfig("locomotion")).toEqual({ applyRootMotion: true, bakeIntoPoseXZ: false, bakeIntoPoseY: true });
  });

  it("bakes root motion into the pose for in-place actions so attacks don't shove the character through geometry", () => {
    expect(generateRootMotionConfig("in-place-action")).toEqual({ applyRootMotion: false, bakeIntoPoseXZ: true, bakeIntoPoseY: true });
  });
});
