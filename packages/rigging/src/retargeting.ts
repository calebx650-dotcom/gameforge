export type HumanoidSlot =
  | "Hips"
  | "Spine"
  | "Chest"
  | "Neck"
  | "Head"
  | "LeftUpperArm"
  | "LeftLowerArm"
  | "LeftHand"
  | "RightUpperArm"
  | "RightLowerArm"
  | "RightHand"
  | "LeftUpperLeg"
  | "LeftLowerLeg"
  | "LeftFoot"
  | "RightUpperLeg"
  | "RightLowerLeg"
  | "RightFoot";

const REQUIRED_SLOTS: HumanoidSlot[] = [
  "Hips",
  "Spine",
  "Head",
  "LeftUpperArm",
  "LeftLowerArm",
  "LeftHand",
  "RightUpperArm",
  "RightLowerArm",
  "RightHand",
  "LeftUpperLeg",
  "LeftLowerLeg",
  "LeftFoot",
  "RightUpperLeg",
  "RightLowerLeg",
  "RightFoot",
];

// Ordered most-specific-first so e.g. "Spine2"/"UpperChest" resolve to
// Chest before the looser Spine pattern could claim them, and a bone
// already claimed by an earlier (more specific) slot is never reused.
const SLOT_PATTERNS: Array<{ slot: HumanoidSlot; pattern: RegExp }> = [
  { slot: "Hips", pattern: /hips?|pelvis/i },
  { slot: "Chest", pattern: /upper.?chest|spine.?2/i },
  { slot: "Neck", pattern: /neck/i },
  { slot: "Head", pattern: /head/i },
  // Forearm/foreleg checked before the bare-arm/leg fallbacks below so
  // Mixamo-style "LeftForeArm"/"LeftUpLeg" resolve correctly: UpLeg before
  // the bare "leg" catch-all (so "LeftLeg" doesn't steal it), ForeArm
  // before the bare "arm" catch-all (so "LeftArm" doesn't steal it).
  { slot: "LeftLowerArm", pattern: /left.*(forearm|lower.?arm)/i },
  { slot: "RightLowerArm", pattern: /right.*(forearm|lower.?arm)/i },
  { slot: "LeftUpperLeg", pattern: /left.*(thigh|upper.?leg|upleg)/i },
  { slot: "RightUpperLeg", pattern: /right.*(thigh|upper.?leg|upleg)/i },
  { slot: "LeftHand", pattern: /left.*hand/i },
  { slot: "RightHand", pattern: /right.*hand/i },
  { slot: "LeftFoot", pattern: /left.*foot/i },
  { slot: "RightFoot", pattern: /right.*foot/i },
  { slot: "LeftUpperArm", pattern: /left.*(upper.?arm|shoulder|arm)/i },
  { slot: "RightUpperArm", pattern: /right.*(upper.?arm|shoulder|arm)/i },
  { slot: "LeftLowerLeg", pattern: /left.*(shin|calf|lower.?leg|knee|leg)/i },
  { slot: "RightLowerLeg", pattern: /right.*(shin|calf|lower.?leg|knee|leg)/i },
  // Spine is deliberately last and loosest — it must not steal a bone a
  // more specific pattern above would otherwise have matched.
  { slot: "Spine", pattern: /spine/i },
];

export interface HumanoidAvatarMapping {
  /** Humanoid slot -> matched source bone name. Slots with no match are omitted. */
  boneMap: Partial<Record<HumanoidSlot, string>>;
  unmappedRequiredSlots: HumanoidSlot[];
  isValid: boolean;
}

/**
 * Maps arbitrary source bone names (Mixamo's "mixamorig:LeftForeArm",
 * Blender's "left_forearm", a bare "LeftLowerArm", ...) onto Unity's
 * Mecanim Humanoid bone slots using name-pattern heuristics, so a rig
 * built by any of the local pipelines above (Blender auto-rig, a TRELLIS/
 * TripoSR mesh someone rigged externally) can be retargeted without
 * hand-wiring the Avatar mapping in the Unity Editor for every character.
 * This is a best-effort heuristic, not a guarantee — `isValid` tells the
 * caller whether every bone Mecanim actually requires was found.
 */
export function generateHumanoidAvatarMapping(boneNames: string[]): HumanoidAvatarMapping {
  const boneMap: Partial<Record<HumanoidSlot, string>> = {};
  const usedBones = new Set<string>();

  for (const { slot, pattern } of SLOT_PATTERNS) {
    const match = boneNames.find((name) => !usedBones.has(name) && pattern.test(name.replace(/^mixamorig:?/i, "")));
    if (match) {
      boneMap[slot] = match;
      usedBones.add(match);
    }
  }

  const unmappedRequiredSlots = REQUIRED_SLOTS.filter((slot) => !boneMap[slot]);
  return { boneMap, unmappedRequiredSlots, isValid: unmappedRequiredSlots.length === 0 };
}

export interface AnimatorParameter {
  name: string;
  type: "float" | "bool" | "trigger" | "int";
}

export interface BlendTreeEntry {
  motion: string;
  threshold: number;
}

export interface AnimatorState {
  name: string;
  motion?: string;
  blendTree?: { parameter: string; entries: BlendTreeEntry[] };
}

export interface AnimatorTransitionCondition {
  parameter: string;
  mode: "greater" | "less" | "equals" | "trigger";
  threshold?: number;
}

export interface AnimatorTransition {
  from: string;
  to: string;
  conditions: AnimatorTransitionCondition[];
  hasExitTime?: boolean;
}

export interface AnimatorControllerSpec {
  parameters: AnimatorParameter[];
  states: AnimatorState[];
  transitions: AnimatorTransition[];
  defaultState: string;
}

export interface LocomotionAnimatorOptions {
  idleClip?: string;
  walkClip?: string;
  runClip?: string;
  attackClips?: string[];
  hitReactionClip?: string;
}

/**
 * Generates a standard third-person combat character's Animator
 * Controller state machine: a Locomotion state whose 1D blend tree
 * crossfades idle/walk/run by a "Speed" float, one state per attack clip
 * (triggered by an "Attack" trigger + matching "AttackIndex" int, with
 * exit-time transitions back to Locomotion), and a Hit Reaction state
 * that any state can transition into on a "Hit" trigger and that always
 * returns to Locomotion. This is data — the future Unity bridge builds
 * the real `AnimatorController` asset from it via Unity's
 * `AnimatorController` scripting API.
 */
export function generateLocomotionAnimatorController(options: LocomotionAnimatorOptions = {}): AnimatorControllerSpec {
  const idleClip = options.idleClip ?? "Idle";
  const walkClip = options.walkClip ?? "Walk";
  const runClip = options.runClip ?? "Run";
  const attackClips = options.attackClips ?? [];
  const hitReactionClip = options.hitReactionClip ?? "HitReaction";

  const parameters: AnimatorParameter[] = [
    { name: "Speed", type: "float" },
    { name: "Attack", type: "trigger" },
    { name: "AttackIndex", type: "int" },
    { name: "Hit", type: "trigger" },
  ];

  const locomotionState: AnimatorState = {
    name: "Locomotion",
    blendTree: {
      parameter: "Speed",
      entries: [
        { motion: idleClip, threshold: 0 },
        { motion: walkClip, threshold: 0.5 },
        { motion: runClip, threshold: 1 },
      ],
    },
  };

  const attackStates: AnimatorState[] = attackClips.map((clip, i) => ({ name: `Attack_${i}`, motion: clip }));
  const hitState: AnimatorState = { name: "HitReaction", motion: hitReactionClip };

  const transitions: AnimatorTransition[] = [];
  attackClips.forEach((_clip, i) => {
    transitions.push({
      from: "Locomotion",
      to: `Attack_${i}`,
      conditions: [
        { parameter: "Attack", mode: "trigger" },
        { parameter: "AttackIndex", mode: "equals", threshold: i },
      ],
    });
    transitions.push({ from: `Attack_${i}`, to: "Locomotion", conditions: [], hasExitTime: true });
  });

  for (const state of [locomotionState, ...attackStates]) {
    transitions.push({ from: state.name, to: "HitReaction", conditions: [{ parameter: "Hit", mode: "trigger" }] });
  }
  transitions.push({ from: "HitReaction", to: "Locomotion", conditions: [], hasExitTime: true });

  return {
    parameters,
    states: [locomotionState, ...attackStates, hitState],
    transitions,
    defaultState: "Locomotion",
  };
}

export type RagdollColliderShape = "capsule" | "box" | "sphere";

export interface RagdollJointConfig {
  boneName: string;
  colliderShape: RagdollColliderShape;
  mass: number;
  angularXLimitDegrees: { min: number; max: number };
  angularYLimitDegrees: { min: number; max: number };
  angularZLimitDegrees: { min: number; max: number };
}

const RAGDOLL_PRESETS: Record<string, Omit<RagdollJointConfig, "boneName">> = {
  head: { colliderShape: "sphere", mass: 5, angularXLimitDegrees: { min: -40, max: 40 }, angularYLimitDegrees: { min: -60, max: 60 }, angularZLimitDegrees: { min: -30, max: 30 } },
  spine: { colliderShape: "capsule", mass: 20, angularXLimitDegrees: { min: -20, max: 20 }, angularYLimitDegrees: { min: -30, max: 30 }, angularZLimitDegrees: { min: -20, max: 20 } },
  upperArm: { colliderShape: "capsule", mass: 4, angularXLimitDegrees: { min: -90, max: 90 }, angularYLimitDegrees: { min: -80, max: 80 }, angularZLimitDegrees: { min: -60, max: 90 } },
  lowerArm: { colliderShape: "capsule", mass: 3, angularXLimitDegrees: { min: -10, max: 10 }, angularYLimitDegrees: { min: -10, max: 10 }, angularZLimitDegrees: { min: 0, max: 140 } },
  upperLeg: { colliderShape: "capsule", mass: 8, angularXLimitDegrees: { min: -70, max: 70 }, angularYLimitDegrees: { min: -50, max: 50 }, angularZLimitDegrees: { min: -20, max: 90 } },
  lowerLeg: { colliderShape: "capsule", mass: 5, angularXLimitDegrees: { min: -10, max: 10 }, angularYLimitDegrees: { min: -10, max: 10 }, angularZLimitDegrees: { min: -140, max: 0 } },
  hand: { colliderShape: "box", mass: 1, angularXLimitDegrees: { min: -20, max: 20 }, angularYLimitDegrees: { min: -20, max: 20 }, angularZLimitDegrees: { min: -20, max: 20 } },
  foot: { colliderShape: "box", mass: 1.5, angularXLimitDegrees: { min: -20, max: 20 }, angularYLimitDegrees: { min: -10, max: 10 }, angularZLimitDegrees: { min: -20, max: 20 } },
};

/**
 * Generates ragdoll joint configuration (collider shape, mass, and
 * angular swing/twist limits) for every non-root bone in a Humanoid
 * avatar mapping, using per-limb presets rather than one generic
 * configuration — a head and a lower leg should not swing the same
 * amount. Feeds a future Unity bridge's `CharacterJoint`/collider setup.
 */
export function generateRagdollConfig(boneMap: Partial<Record<HumanoidSlot, string>>): RagdollJointConfig[] {
  const configs: RagdollJointConfig[] = [];
  const presetFor = (slot: HumanoidSlot): keyof typeof RAGDOLL_PRESETS | undefined => {
    if (slot === "Head") return "head";
    if (slot === "Spine" || slot === "Chest") return "spine";
    if (slot.includes("UpperArm")) return "upperArm";
    if (slot.includes("LowerArm")) return "lowerArm";
    if (slot.includes("UpperLeg")) return "upperLeg";
    if (slot.includes("LowerLeg")) return "lowerLeg";
    if (slot.includes("Hand")) return "hand";
    if (slot.includes("Foot")) return "foot";
    return undefined;
  };

  for (const [slot, boneName] of Object.entries(boneMap) as Array<[HumanoidSlot, string]>) {
    if (slot === "Hips") continue; // root bone carries no joint of its own
    const presetKey = presetFor(slot);
    if (!presetKey || !boneName) continue;
    configs.push({ boneName, ...RAGDOLL_PRESETS[presetKey] });
  }
  return configs;
}

export interface RootMotionConfig {
  applyRootMotion: boolean;
  bakeIntoPoseXZ: boolean;
  bakeIntoPoseY: boolean;
}

/**
 * Root motion should drive actual world-space movement for locomotion
 * clips (so the character doesn't slide relative to its own animation)
 * but should be baked into the pose — i.e. NOT move the transform — for
 * attacks/hit-reactions performed in place, otherwise an attack animation
 * with a forward lunge would shove the character through geometry every
 * time it plays regardless of gameplay-code-driven movement.
 */
export function generateRootMotionConfig(clipKind: "locomotion" | "in-place-action"): RootMotionConfig {
  if (clipKind === "locomotion") {
    return { applyRootMotion: true, bakeIntoPoseXZ: false, bakeIntoPoseY: true };
  }
  return { applyRootMotion: false, bakeIntoPoseXZ: true, bakeIntoPoseY: true };
}
