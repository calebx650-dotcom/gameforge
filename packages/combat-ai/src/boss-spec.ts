export interface AttackSpec {
  name: string;
  cooldownSeconds: number;
  damage: number;
  range: "melee" | "ranged" | "aoe";
  /** Names of attacks that may follow this one as part of a combo string. */
  comboChain?: string[];
}

export interface PhaseSpec {
  name: string;
  /** Phase becomes active once boss health drops to or below this fraction of max health (1 = full health). */
  healthThreshold: number;
  attacks: AttackSpec[];
  enraged?: boolean;
  moveSpeedMultiplier?: number;
}

export interface BossSpec {
  name: string;
  phases: PhaseSpec[];
}
