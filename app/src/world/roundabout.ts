// Roundabouts at arterial junctions (v0.8.3, spec 2): which junctions, the rect R the asset is stretched over, the
// road / walk class of each cell of R (from the asset's 15 x 13 roundabout), and the centre island block.
// Pure functions of (seed, junction indices / world cells); negative coordinates work.
import { hash01, hashPick } from './hash';
import { vLine, hLine } from './arterials';
import { isRoundabout, junctionZone } from './junction';
import { ZONE_NAME } from './zone';
import { ARTERIAL_SPACING, ROUNDABOUT_CHANCE, ROUNDABOUT_MARGIN, ROUNDABOUT_ISLAND, ROUNDABOUT_CACHE, ZONES } from './config';
import type { BlockRec, Rect, ZoneKind } from './types';

export { isRoundabout };

/** Road ('r', 'A' = plain asphalt, source cell equal to (15, 1)) or walk ('w') of the asset's roundabout, indexed
 *  [row - 9][col - 14] (source cols 14..28, rows 9..21 of a 2_City_Terrains paving block). Measured from the asset:
 *  a cell with >= 128 asphalt pixels is road (tools/export_roundabout.py re-derives it). */
export const RB_CLASS: readonly string[] = [
  'wwwwwwrArwwwwww', 'wwwwwrrArrwwwww', 'wwwrrrrrrrrrwww', 'wwrrrAAAAArrrww', 'wrrrArrwrrArrrw',
  'rrrAArrwrrAArrr', 'AArAArwwwrAArAA', 'rrrAArrrrrAArrr', 'wrrrAAAAAAArrrw', 'wwArrAAAAArrAww',
  'wwrArrrrrrrArww', 'wwwwrrrArrrwwww', 'wwwwwwrArwwwwww',
];
const SRC = { col: 14, row: 9 } as const;          // top-left source cell of the roundabout in a paving block
const ARM = { col: 21, row: 15 } as const;         // the source arm's middle column / row, repeated to stretch

export interface Roundabout {
  i: number; j: number;
  x0: number; y0: number;                          // left edge of vertical arterial i / top edge of horizontal arterial j
  wv: number; wh: number;                          // their widths
  R: Rect;                                         // the junction plus ROUNDABOUT_MARGIN each way
  island: Rect;                                    // the centre island (a block, `r<i>,<j>`)
  zone: ZoneKind;
}

const memo = new Map<string, Roundabout | null>();

/** The roundabout at junction (i, j), or null when the junction is a plain crossing. */
export function roundabout(seed: string, i: number, j: number): Roundabout | null {
  const key = `${seed}|${i},${j}`;
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  let out: Roundabout | null = null;
  if (isRoundabout(seed, i, j)) {
    const v = vLine(seed, i, j), h = hLine(seed, j, i);    // neither jogs next to a roundabout
    const M = ROUNDABOUT_MARGIN, I = ROUNDABOUT_ISLAND;
    out = Object.freeze({
      i, j, x0: v.x0, y0: h.y0, wv: v.w, wh: h.h,
      R: Object.freeze({ x0: v.x0 - M.x, x1: v.x0 + v.w + M.x, y0: h.y0 - M.y, y1: h.y0 + h.h + M.y }),
      island: Object.freeze({ x0: v.x0 - I.x, x1: v.x0 + v.w + I.x, y0: h.y0 - I.y, y1: h.y0 + h.h + I.y }),
      zone: junctionZone(seed, i, j),
    });
  }
  if (memo.size >= ROUNDABOUT_CACHE) memo.delete(memo.keys().next().value!);
  memo.set(key, out);
  return out;
}

const hits = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** Roundabouts whose R intersects r, sorted by (i, j). The jitter moves a junction less than half a spacing and R
 *  reaches at most ~15 cells from it, so one spacing of slack on each side is enough. */
export function roundaboutsIn(seed: string, r: Rect): Roundabout[] {
  const S = ARTERIAL_SPACING;
  const i0 = Math.floor(r.x0 / S.x) - 1, i1 = Math.floor((r.x1 - 1) / S.x) + 1;
  const j0 = Math.floor(r.y0 / S.y) - 1, j1 = Math.floor((r.y1 - 1) / S.y) + 1;
  const out: Roundabout[] = [];
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const rb = roundabout(seed, i, j);
    if (rb && hits(rb.R, r)) out.push(rb);
  }
  return out;
}

/** The roundabout whose R contains (x, y), or null. */
export function roundaboutAt(seed: string, x: number, y: number): Roundabout | null {
  return roundaboutsIn(seed, { x0: x, y0: y, x1: x + 1, y1: y + 1 })[0] ?? null;
}

/** Source cell (col 14..28, row 9..21) of the asset's roundabout for world cell (x, y) of R (spec 2.3): the corners
 *  are copied, the arms' middle column / row stretched, so source col 20 / 22 lands on the vertical arterial's edges
 *  x0 / x0 + wv - 1 and source row 14 / 16 on y0 / y0 + wh - 1. */
export function rbSource(rb: Roundabout, x: number, y: number): [number, number] {
  const M = ROUNDABOUT_MARGIN;
  const u = x - rb.R.x0, v = y - rb.R.y0;
  const col = u <= M.x ? SRC.col + u : u < rb.wv + M.x - 1 ? ARM.col : u - (rb.wv + M.x - 1) + ARM.col + 1;
  const row = v <= M.y ? SRC.row + v : v < rb.wh + M.y - 1 ? ARM.row : v - (rb.wh + M.y - 1) + ARM.row + 1;
  return [col, row];
}

/** Road or walk at world cell (x, y) of R by the asset (not meaningful inside the island). */
export function rbClass(rb: Roundabout, x: number, y: number): 'walk' | 'road' {
  const [c, r] = rbSource(rb, x, y);
  return RB_CLASS[r - SRC.row][c - SRC.col] === 'w' ? 'walk' : 'road';
}

export function roundaboutWhy(seed: string, rb: Roundabout): string {
  const p = hash01(seed, 'rb', rb.i, rb.j);
  return `环岛：竖向主干道 ${rb.i}（宽 ${rb.wv}）和横向主干道 ${rb.j}（宽 ${rb.wh}）的路口，${ZONE_NAME[rb.zone]}区，`
    + `散列 ${p.toFixed(2)} < 概率 ${ROUNDABOUT_CHANCE[rb.zone]}；路口两边的四段主干道不错位，环岛占 ${rb.R.x1 - rb.R.x0}×${rb.R.y1 - rb.R.y0} 格`;
}

const islands = new Map<string, BlockRec>();

/** The centre island of a roundabout as a block (spec 2.4): id `r<i>,<j>`, sidewalk 2, no buildings, frozen and cached. */
export function islandBlock(seed: string, rb: Roundabout): BlockRec {
  const key = `${seed}|${rb.i},${rb.j}`;
  const hit = islands.get(key);
  if (hit) return hit;
  const id = `r${rb.i},${rb.j}`, f = rb.island, I = ROUNDABOUT_ISLAND;
  const rec: BlockRec = {
    id, cell: [rb.i, rb.j], foot: [{ ...f }], sw: 2, zone: rb.zone,
    paving: hashPick(seed, ZONES[rb.zone].paving, 'blk', id),
    shape: 'roundabout',
    why: [roundaboutWhy(seed, rb),
      `中心小岛 ${f.x1 - f.x0}×${f.y1 - f.y0}：路口向外扩 ${I.x} 格（横）/ ${I.y} 格（竖），外面留两条车道宽的环道；不进人的绿岛，不放楼`],
  };
  const out = deepFreeze(rec);
  if (islands.size >= ROUNDABOUT_CACHE) islands.delete(islands.keys().next().value!);
  islands.set(key, out);
  return out;
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as object)) deepFreeze(v);
  }
  return o;
}
