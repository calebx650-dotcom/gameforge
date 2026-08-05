export type { AttackSpec, PhaseSpec, BossSpec } from "./boss-spec.js";
export { generateBossBehaviorTree } from "./behavior-tree.js";
export type { BTNode, BTNodeType } from "./behavior-tree.js";
export { buildComboGraph, validateComboGraph } from "./combo-graph.js";
export type { ComboGraph } from "./combo-graph.js";
export { bindHitboxToAnimation, validateHitboxFrames } from "./hitbox.js";
export type { HitboxFrame, HitboxShape, HurtboxWindow, AnimationClipInfo, BindHitboxOptions } from "./hitbox.js";
