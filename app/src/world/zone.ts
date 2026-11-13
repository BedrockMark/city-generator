// Zone noise: a pure function of (seed, x, y), so any world cell can be classified locally.
import { hash01 } from './hash';
import { ARTERIAL_SPACING, ZONE_THRESHOLDS, ZONE_OCTAVE } from './config';
import type { ZoneKind } from './types';

export const ZONE_NAME: Record<ZoneKind, string> = { downtown: '闹市', mixed: '混合', residential: '住宅' };

const smooth = (t: number) => t * t * (3 - 2 * t);

// Smoothly interpolated lattice noise; lattice points sit at the nominal centre of each (scaled) arterial cell.
function layer(seed: string, tag: string, x: number, y: number, sx: number, sy: number): number {
  const u = x / sx - 0.5, v = y / sy - 0.5;
  const i = Math.floor(u), j = Math.floor(v);          // floor, not truncation: correct for negative coordinates
  const fx = smooth(u - i), fy = smooth(v - j);
  const a = hash01(seed, tag, i, j), b = hash01(seed, tag, i + 1, j);
  const c = hash01(seed, tag, i, j + 1), d = hash01(seed, tag, i + 1, j + 1);
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

/** Zone value in [0, 1]: a fine layer plus a low-frequency layer, normalised. */
export function zoneValue(seed: string, x: number, y: number): number {
  const { x: sx, y: sy } = ARTERIAL_SPACING;
  const lo = layer(seed, 'zone', x, y, sx, sy);
  const hi = layer(seed, 'zone2', x, y, sx * ZONE_OCTAVE.scale, sy * ZONE_OCTAVE.scale);
  return (lo + ZONE_OCTAVE.weight * hi) / (1 + ZONE_OCTAVE.weight);
}

export function zoneAt(seed: string, x: number, y: number): ZoneKind {
  const z = zoneValue(seed, x, y);
  return z >= ZONE_THRESHOLDS.downtown ? 'downtown' : z < ZONE_THRESHOLDS.residential ? 'residential' : 'mixed';
}
