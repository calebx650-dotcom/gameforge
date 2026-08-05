import { describe, expect, it } from "vitest";
import { buildComboGraph, validateComboGraph } from "./combo-graph.js";
import type { BossSpec } from "./boss-spec.js";

describe("combo graph", () => {
  const validSpec: BossSpec = {
    name: "Boss",
    phases: [
      {
        name: "p1",
        healthThreshold: 1,
        attacks: [
          { name: "jab", cooldownSeconds: 1, damage: 5, range: "melee", comboChain: ["hook", "uppercut"] },
          { name: "hook", cooldownSeconds: 2, damage: 10, range: "melee", comboChain: ["uppercut"] },
          { name: "uppercut", cooldownSeconds: 3, damage: 15, range: "melee" },
        ],
      },
    ],
  };

  it("builds an edge list of eligible follow-up attacks", () => {
    const graph = buildComboGraph(validSpec);
    expect(graph.edges.get("jab")).toEqual(["hook", "uppercut"]);
    expect(graph.edges.get("uppercut")).toEqual([]);
  });

  it("passes validation for a well-formed spec", () => {
    expect(validateComboGraph(validSpec)).toEqual([]);
  });

  it("flags a combo chain into a non-existent attack", () => {
    const broken: BossSpec = {
      name: "Boss",
      phases: [{ name: "p1", healthThreshold: 1, attacks: [{ name: "jab", cooldownSeconds: 1, damage: 5, range: "melee", comboChain: ["ghost_move"] }] }],
    };
    const errors = validateComboGraph(broken);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/unknown attack "ghost_move"/);
  });

  it("flags an attack that combos directly into itself", () => {
    const broken: BossSpec = {
      name: "Boss",
      phases: [{ name: "p1", healthThreshold: 1, attacks: [{ name: "jab", cooldownSeconds: 1, damage: 5, range: "melee", comboChain: ["jab"] }] }],
    };
    const errors = validateComboGraph(broken);
    expect(errors.some((e) => e.includes("combos directly into itself"))).toBe(true);
  });
});
