export type HitboxShape = "sphere" | "box" | "capsule";

export interface AnimationClipInfo {
  totalFrames: number;
  frameRate: number;
}

export interface HitboxFrame {
  attackName: string;
  /** Inclusive frame range during which the hitbox is active and can deal damage. */
  startFrame: number;
  endFrame: number;
  shape: HitboxShape;
  boneAttachment: string;
  damageMultiplier?: number;
}

export interface HurtboxWindow {
  attackName: string;
  /** Frame range during which the attacker has hyper-armor / is not interruptible, if any. */
  hyperArmorStartFrame?: number;
  hyperArmorEndFrame?: number;
}

export interface BindHitboxOptions {
  shape?: HitboxShape;
  boneAttachment?: string;
  /** Fraction of the clip (0-1) where the active hitbox window starts; defaults to a 20/20/60 startup/active/recovery split. */
  startFraction?: number;
  endFraction?: number;
  damageMultiplier?: number;
}

/**
 * Binds an attack's hitbox to a specific frame window of its animation
 * clip. Absent explicit overrides, uses a standard startup/active/recovery
 * split (20% startup, next 20% active, remaining 60% recovery) — a
 * reasonable default for a weapon swing that a designer can then hand-tune
 * per attack.
 */
export function bindHitboxToAnimation(attackName: string, clip: AnimationClipInfo, options: BindHitboxOptions = {}): HitboxFrame {
  const startFraction = options.startFraction ?? 0.2;
  const endFraction = options.endFraction ?? 0.4;
  if (startFraction < 0 || endFraction > 1 || startFraction >= endFraction) {
    throw new Error(`Invalid hitbox window fractions: start=${startFraction}, end=${endFraction}`);
  }

  return {
    attackName,
    startFrame: Math.round(clip.totalFrames * startFraction),
    endFrame: Math.round(clip.totalFrames * endFraction),
    shape: options.shape ?? "capsule",
    boneAttachment: options.boneAttachment ?? "weapon_tip",
    damageMultiplier: options.damageMultiplier,
  };
}

/**
 * Validates a set of hitbox frame bindings against their clip lengths:
 * frames must be in range, start must precede end, and two hitboxes for
 * the *same* attack name must not overlap (that would double-hit on a
 * single swing).
 */
export function validateHitboxFrames(frames: HitboxFrame[], totalFrames: number): string[] {
  const errors: string[] = [];

  for (const frame of frames) {
    if (frame.startFrame < 0 || frame.endFrame > totalFrames) {
      errors.push(`"${frame.attackName}": frame range [${frame.startFrame}, ${frame.endFrame}] is outside clip length ${totalFrames}`);
    }
    if (frame.startFrame >= frame.endFrame) {
      errors.push(`"${frame.attackName}": startFrame (${frame.startFrame}) must be before endFrame (${frame.endFrame})`);
    }
  }

  const byAttack = new Map<string, HitboxFrame[]>();
  for (const frame of frames) {
    byAttack.set(frame.attackName, [...(byAttack.get(frame.attackName) ?? []), frame]);
  }
  for (const [attackName, group] of byAttack) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (group[i].startFrame < group[j].endFrame && group[i].endFrame > group[j].startFrame) {
          errors.push(`"${attackName}": overlapping hitbox windows [${group[i].startFrame}-${group[i].endFrame}] and [${group[j].startFrame}-${group[j].endFrame}]`);
        }
      }
    }
  }

  return errors;
}
