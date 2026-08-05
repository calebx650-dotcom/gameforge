import { describe, expect, it } from "vitest";
import { generateBossBehaviorTree } from "./behavior-tree.js";
import type { BossSpec } from "./boss-spec.js";

const spec: BossSpec = {
  name: "The Skinless Cardinal",
  phases: [
    {
      name: "phase1",
      healthThreshold: 1,
      attacks: [
        { name: "crozier_slam", cooldownSeconds: 4, damage: 20, range: "melee", comboChain: ["crozier_sweep"] },
        { name: "crozier_sweep", cooldownSeconds: 3, damage: 12, range: "melee" },
      ],
    },
    {
      name: "phase2_enraged",
      healthThreshold: 0.4,
      enraged: true,
      attacks: [{ name: "blood_nova", cooldownSeconds: 8, damage: 40, range: "aoe" }],
    },
  ],
};

describe("generateBossBehaviorTree", () => {
  it("creates one phase branch per phase, gated by a health-threshold condition", () => {
    const tree = generateBossBehaviorTree(spec);
    expect(tree.type).toBe("selector");
    expect(tree.children).toHaveLength(2);

    const [phase1Branch, phase2Branch] = tree.children!;
    expect(phase1Branch.name).toBe("phase:phase1");
    expect(phase2Branch.name).toBe("phase:phase2_enraged");

    const phase2Condition = phase2Branch.children!.find((c) => c.type === "condition")!;
    expect(phase2Condition.condition).toContain("health <= 0.4");
  });

  it("halves attack cooldowns in enraged phases", () => {
    const tree = generateBossBehaviorTree(spec);
    const phase2Branch = tree.children![1];
    const attackSelector = phase2Branch.children!.find((c) => c.type === "selector")!;
    const decorator = attackSelector.children![0];
    expect(decorator.type).toBe("decorator");
    expect(decorator.decorator).toBe("cooldown:4"); // 8s halved
  });

  it("wraps combo chains in a sequence following the initial action", () => {
    const tree = generateBossBehaviorTree(spec);
    const phase1Branch = tree.children![0];
    const attackSelector = phase1Branch.children!.find((c) => c.type === "selector")!;
    const slamDecorator = attackSelector.children!.find((c) => c.name === "crozier_slam cooldown")!;
    const comboSequence = slamDecorator.children![0];
    expect(comboSequence.type).toBe("sequence");
    expect(comboSequence.children!.map((c) => c.action)).toEqual(["crozier_slam", "crozier_sweep"]);
  });
});
