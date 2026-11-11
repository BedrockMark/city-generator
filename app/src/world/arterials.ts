// Arterial roads: a jittered grid of vertical / horizontal lines, each line broken into segments between junctions.
// Everything is a pure function of (seed, indices), so any cell can be computed locally and in any order.
import { hashInt, hashPick } from './hash';
import { ARTERIAL_SPACING, ARTERIAL_JITTER, ARTERIAL_JOG, ARTERIAL_WIDTHS } from './config';
import type { Rect } from './types';

const vWidth = (seed: string, i: number): number => hashPick(seed, ARTERIAL_WIDTHS.v, 'art.v.w', i);
const hWidth = (seed: string, j: number): number => hashPick(seed, ARTERIAL_WIDTHS.h, 'art.h.w', j);
const vJitter = (seed: string, i: number): number => hashInt(seed, -ARTERIAL_JITTER, ARTERIAL_JITTER, 'art.v.jit', i);
const hJitter = (seed: string, j: number): number => hashInt(seed, -ARTERIAL_JITTER, ARTERIAL_JITTER, 'art.h.jit', j);

/** Column band [x0, x0 + w) of vertical arterial i between horizontal arterials j and j+1. */
export function vLine(seed: string, i: number, j: number): { x0: number; w: number } {
  const jog = hashInt(seed, 0, ARTERIAL_JOG, 'art.v.jog', i, j);
  return { x0: i * ARTERIAL_SPACING.x + vJitter(seed, i) + jog, w: vWidth(seed, i) };
}

/** Row band [y0, y0 + h) of horizontal arterial j between vertical arterials i and i+1. */
export function hLine(seed: string, j: number, i: number): { y0: number; h: number } {
  const jog = hashInt(seed, 0, ARTERIAL_JOG, 'art.h.jog', j, i);
  return { y0: j * ARTERIAL_SPACING.y + hJitter(seed, j) + jog, h: hWidth(seed, j) };
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

export function arterialWhy(seed: string, axis: 'v' | 'h', n: number): string {
  const w = axis === 'v' ? vWidth(seed, n) : hWidth(seed, n);
  const off = axis === 'v' ? vJitter(seed, n) : hJitter(seed, n);
  return `${axis === 'v' ? '竖向' : '横向'}主干道 ${n}：宽 ${w} 格（散列抽到），位置偏移 ${off < 0 ? '−' : ''}${Math.abs(off)} 格`;
}
