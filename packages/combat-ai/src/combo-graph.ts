import type { AttackSpec, BossSpec } from "./boss-spec.js";

export interface ComboGraph {
  /** attack name -> names of attacks that can follow it */
  edges: Map<string, string[]>;
}

/**
 * Builds the combo transition graph across every attack in every phase of
 * a boss spec — the data an animation blend tree or combat controller
 * would use to decide which follow-up attacks are eligible after the
 * current one lands. Deduplicates attacks that appear in more than one
 * phase by name.
 */
export function buildComboGraph(spec: BossSpec): ComboGraph {
  const edges = new Map<string, string[]>();
  for (const phase of spec.phases) {
    for (const attack of phase.attacks) {
      const existing = edges.get(attack.name) ?? [];
      edges.set(attack.name, dedupe([...existing, ...(attack.comboChain ?? [])]));
    }
  }
  return { edges };
}

/**
 * Validates that every combo chain references an attack that actually
 * exists somewhere in the spec, and flags any attack that combos into
 * itself (an infinite loop with no cooldown, generally a design bug
 * rather than an intentional rapid-combo attack).
 */
export function validateComboGraph(spec: BossSpec): string[] {
  const allAttackNames = new Set(spec.phases.flatMap((p) => p.attacks.map((a) => a.name)));
  const errors: string[] = [];

  for (const phase of spec.phases) {
    for (const attack of phase.attacks) {
      for (const followUp of attack.comboChain ?? []) {
        if (!allAttackNames.has(followUp)) {
          errors.push(`Phase "${phase.name}": attack "${attack.name}" combos into unknown attack "${followUp}"`);
        }
        if (followUp === attack.name) {
          errors.push(`Phase "${phase.name}": attack "${attack.name}" combos directly into itself`);
        }
      }
    }
  }
  return errors;
}

function dedupe(names: string[]): string[] {
  return Array.from(new Set(names));
}
