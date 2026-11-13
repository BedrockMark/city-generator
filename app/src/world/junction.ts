// Arterial junctions: per-line jitter and width, and whether a junction is a roundabout. Kept apart from arterials.ts
// and roundabout.ts so both can import it without an import cycle (arterials needs isRoundabout for the jog,
// roundabout needs the lines).
import { hash01, hashInt, hashPick } from './hash';
import { zoneAt } from './zone';
import { ARTERIAL_SPACING, ARTERIAL_JITTER, ARTERIAL_WIDTHS, ROUNDABOUT_CHANCE, JUNCTION_CACHE } from './config';
import type { ZoneKind } from './types';

export const vWidth = (seed: string, i: number): number => hashPick(seed, ARTERIAL_WIDTHS.v, 'art.v.w', i);
export const hWidth = (seed: string, j: number): number => hashPick(seed, ARTERIAL_WIDTHS.h, 'art.h.w', j);
export const vJitter = (seed: string, i: number): number => hashInt(seed, -ARTERIAL_JITTER, ARTERIAL_JITTER, 'art.v.jit', i);
export const hJitter = (seed: string, j: number): number => hashInt(seed, -ARTERIAL_JITTER, ARTERIAL_JITTER, 'art.h.jit', j);

/** Zone of junction (i, j), taken at the nominal crossing point (jitter, no jog: the jog depends on isRoundabout). */
export function junctionZone(seed: string, i: number, j: number): ZoneKind {
  return zoneAt(seed, i * ARTERIAL_SPACING.x + vJitter(seed, i), j * ARTERIAL_SPACING.y + hJitter(seed, j));
}

/** Is the junction of vertical arterial i and horizontal arterial j a roundabout? A hash per junction against
 *  ROUNDABOUT_CHANCE of the junction's zone (spec 2.2). */
export function isRoundabout(seed: string, i: number, j: number): boolean {
  const key = `${seed}|${i},${j}`;
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  const h = hash01(seed, 'rb', i, j);
  // the zone is only looked up when the hash could pass (every arterial line asks this, so it is memoised too)
  const out = h < MAX_CHANCE && h < ROUNDABOUT_CHANCE[junctionZone(seed, i, j)];
  if (memo.size >= JUNCTION_CACHE) memo.delete(memo.keys().next().value!);
  memo.set(key, out);
  return out;
}

const MAX_CHANCE = Math.max(...Object.values(ROUNDABOUT_CHANCE));
const memo = new Map<string, boolean>();
