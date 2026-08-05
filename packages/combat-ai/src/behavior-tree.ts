import type { AttackSpec, BossSpec, PhaseSpec } from "./boss-spec.js";

export type BTNodeType = "selector" | "sequence" | "parallel" | "condition" | "action" | "decorator";

export interface BTNode {
  id: string;
  type: BTNodeType;
  name: string;
  children?: BTNode[];
  /** Present when type === "condition": a description of what's checked, e.g. "health <= 0.5 && health > 0.2". */
  condition?: string;
  /** Present when type === "action": the concrete attack/behavior this leaf triggers. */
  action?: string;
  /** Present when type === "decorator": e.g. "cooldown:8" or "inverter". */
  decorator?: string;
}

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

/**
 * Auto-generates a behavior tree for a boss encounter from a declarative
 * BossSpec: one phase branch per PhaseSpec, gated by a health-threshold
 * condition, each containing a selector over that phase's attacks (each
 * wrapped in a cooldown decorator) plus combo-chain follow-up sequences.
 * This is the tree a game's AI runtime (Unity Behavior Designer, a custom
 * BT interpreter, whatever) would execute — GameForge generates the
 * structure, it doesn't run it.
 */
export function generateBossBehaviorTree(spec: BossSpec): BTNode {
  counter = 0;
  const sortedPhases = [...spec.phases].sort((a, b) => b.healthThreshold - a.healthThreshold);

  const phaseBranches = sortedPhases.map((phase, index) => {
    const next = sortedPhases[index + 1];
    const lowerBound = next ? next.healthThreshold : 0;
    const condition = `health <= ${phase.healthThreshold} && health > ${lowerBound}`;

    return {
      id: nextId("sequence"),
      type: "sequence" as const,
      name: `phase:${phase.name}`,
      children: [
        { id: nextId("condition"), type: "condition" as const, name: `enter ${phase.name}`, condition },
        generateAttackSelector(phase),
      ],
    };
  });

  return {
    id: nextId("selector"),
    type: "selector",
    name: `${spec.name} root`,
    children: phaseBranches,
  };
}

function generateAttackSelector(phase: PhaseSpec): BTNode {
  const attackNodes = phase.attacks.map((attack) => generateAttackNode(attack, phase));
  return {
    id: nextId("selector"),
    type: "selector",
    name: `${phase.name} attacks${phase.enraged ? " (enraged)" : ""}`,
    children: attackNodes,
  };
}

function generateAttackNode(attack: AttackSpec, phase: PhaseSpec): BTNode {
  const cooldown = phase.enraged ? attack.cooldownSeconds * 0.5 : attack.cooldownSeconds;
  const actionNode: BTNode = { id: nextId("action"), type: "action", name: attack.name, action: attack.name };

  const withCombo: BTNode = attack.comboChain?.length
    ? {
        id: nextId("sequence"),
        type: "sequence",
        name: `${attack.name} combo`,
        children: [actionNode, ...attack.comboChain.map((followUp) => ({ id: nextId("action"), type: "action" as const, name: followUp, action: followUp }))],
      }
    : actionNode;

  return {
    id: nextId("decorator"),
    type: "decorator",
    name: `${attack.name} cooldown`,
    decorator: `cooldown:${cooldown}`,
    children: [withCombo],
  };
}
