// Arterial roads: a jittered grid of vertical / horizontal lines, each line broken into segments between junctions.
// Everything is a pure function of (seed, indices), so any cell can be computed locally and in any order.
import { hashInt } from './hash';
import { ARTERIAL_SPACING, ARTERIAL_JOG } from './config';
import { vWidth, hWidth, vJitter, hJitter, isRoundabout } from './junction';
import type { Rect } from './types';

export { vWidth, hWidth, vJitter, hJitter };

/** Jog (0..ARTERIAL_JOG cells) of one arterial segment: axis 'v', n = i, m = j is vertical arterial i between
 *  horizontal arterials j and j + 1; axis 'h', n = j, m = i is horizontal arterial j between vertical arterials i and
 *  i + 1. A segment ending at a roundabout does not jog, so the roundabout's four arms line up (spec 2.2). */
export function segmentJog(seed: string, axis: 'v' | 'h', n: number, m: number): number {
  if (axis === 'v') return isRoundabout(seed, n, m) || isRoundabout(seed, n, m + 1) ? 0 : hashInt(seed, 0, ARTERIAL_JOG, 'art.v.jog', n, m);
  return isRoundabout(seed, m, n) || isRoundabout(seed, m + 1, n) ? 0 : hashInt(seed, 0, ARTERIAL_JOG, 'art.h.jog', n, m);
}

/** Column band [x0, x0 + w) of vertical arterial i between horizontal arterials j and j+1. */
export function vLine(seed: string, i: number, j: number): { x0: number; w: number } {
  return { x0: i * ARTERIAL_SPACING.x + vJitter(seed, i) + segmentJog(seed, 'v', i, j), w: vWidth(seed, i) };
}

/** Row band [y0, y0 + h) of horizontal arterial j between vertical arterials i and i+1. */
export function hLine(seed: string, j: number, i: number): { y0: number; h: number } {
  return { y0: j * ARTERIAL_SPACING.y + hJitter(seed, j) + segmentJog(seed, 'h', j, i), h: hWidth(seed, j) };
}

/** Interior of arterial cell (i, j): the area between the four bounding bands. */
export function cellRect(seed: string, i: number, j: number): Rect {
  const l = vLine(seed, i, j), r = vLine(seed, i + 1, j);
  const t = hLine(seed, j, i), b = hLine(seed, j + 1, i);
  return { x0: l.x0 + l.w, y0: t.y0 + t.h, x1: r.x0, y1: b.y0 };
}

/** The arterial cell containing (x, y), or null when the point is on an arterial. */
export function cellAt(seed: string, x: number, y: number): [number, number] | null {
  const i0 = Math.floor(x / ARTERIAL_SPACING.x), j0 = Math.floor(y / ARTERIAL_SPACING.y);
  for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) {
    const r = cellRect(seed, i, j);
    if (x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1) return [i, j];
  }
  return null;
}

/** Why of arterial n; with segment indices m (see segmentJog; two when a cell near a junction lies on both) it adds
 *  each segment's jog. */
export function arterialWhy(seed: string, axis: 'v' | 'h', n: number, m?: number | number[]): string {
  const w = axis === 'v' ? vWidth(seed, n) : hWidth(seed, n);
  const off = axis === 'v' ? vJitter(seed, n) : hJitter(seed, n);
  let s = `${axis === 'v' ? '竖向' : '横向'}主干道 ${n}：宽 ${w} 格（散列抽到），位置偏移 ${off < 0 ? '−' : ''}${Math.abs(off)} 格`;
  for (const k of m === undefined ? [] : Array.isArray(m) ? m : [m]) {
    const [a, b] = axis === 'v' ? [[n, k], [n, k + 1]] : [[k, n], [k + 1, n]];   // the junctions (i, j) at the segment's ends
    const rb = isRoundabout(seed, a[0], a[1]) || isRoundabout(seed, b[0], b[1]);
    s += rb ? `；本段（第 ${k} 段）一头或两头有环岛，环岛两边不错位`
      : `；本段（第 ${k} 段）错位 ${segmentJog(seed, axis, n, k)} 格（散列抽到，0..${ARTERIAL_JOG}，整段平移）`;
  }
  return s;
}
