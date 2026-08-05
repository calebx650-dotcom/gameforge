export interface MusicLayer {
  id: string;
  name: string;
  /** Combat-intensity value (0-1) at which this layer should be fully audible. */
  activationThreshold: number;
}

export interface MusicMixEntry {
  layerId: string;
  volume: number;
}

/**
 * Computes a per-layer volume mix for dynamic combat music given a
 * continuous 0-1 intensity value (e.g. derived from boss health remaining,
 * number of enemies engaged, or player low-health state). Each layer ramps
 * from silent to fully audible as intensity approaches its own activation
 * threshold from below (over a `fadeWidth` window), then holds at full
 * volume for any intensity at or above threshold — a straightforward
 * additive layered-music model (think "exploration" / "tension" /
 * "combat" / "climax" stems mixed live and never hard-cut) rather than
 * switching between discrete tracks.
 */
export function computeMusicMix(intensity: number, layers: MusicLayer[], fadeWidth = 0.15): MusicMixEntry[] {
  const clampedIntensity = Math.max(0, Math.min(1, intensity));
  return layers.map((layer) => {
    const distance = clampedIntensity - layer.activationThreshold;
    let volume: number;
    if (distance >= 0) volume = 1;
    else if (distance <= -fadeWidth) volume = 0;
    else volume = (distance + fadeWidth) / fadeWidth;
    return { layerId: layer.id, volume };
  });
}
