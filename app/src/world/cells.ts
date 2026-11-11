// Per-cell classes of the world (road / walk / lot), ownership of road cells by blocks, and zebra crossings.
// Everything is a pure function of (seed, coordinates): rasters are painted from the blocks of the arterial cells
// that can cover them, and every crossing decision is keyed on world coordinates.
import { hash01, hashInt } from './hash';
import { cellAt, cellRect } from './arterials';
import { blockAt, cellBlocks, lotOf } from './blocks';
import { ARTERIAL_SPACING, CROSSING_CHANCE, CROSSING_MIN_RUN, CROSSING_LEN, CROSSING_GAP, ANALYSIS_PAD, ROAD_WIDTHS } from './config';
import { findSegs } from '../gen/layout';
import type { Rect, WorldCell, WorldCls, WCrossing } from './types';

/** Class of one world cell; road cells outside every arterial cell are arterial. */
export function worldCell(seed: string, x: number, y: number): WorldCell {
  const b = blockAt(seed, x, y);
  if (b) return { cls: lotOf(b, x, y) ? 'lot' : 'walk', block: b.id };
  return cellAt(seed, x, y) ? { cls: 'road' } : { cls: 'road', arterial: true };
}

interface Raster { cls: WorldCls[][]; block: (string | null)[][]; art: boolean[][] }

/** Paints r from the blocks of every arterial cell that cellAt could return for a point of r. */
function raster(seed: string, r: Rect): Raster {
  const W = r.x1 - r.x0, H = r.y1 - r.y0;
  const cls: WorldCls[][] = Array.from({ length: H }, () => Array<WorldCls>(W).fill('road'));
  const block: (string | null)[][] = Array.from({ length: H }, () => Array<string | null>(W).fill(null));
  const art: boolean[][] = Array.from({ length: H }, () => Array<boolean>(W).fill(true));
  const i0 = Math.floor(r.x0 / ARTERIAL_SPACING.x) - 1, i1 = Math.floor((r.x1 - 1) / ARTERIAL_SPACING.x) + 1;
  const j0 = Math.floor(r.y0 / ARTERIAL_SPACING.y) - 1, j1 = Math.floor((r.y1 - 1) / ARTERIAL_SPACING.y) + 1;
  const clip = (q: Rect, f: (x: number, y: number) => void) => {
    for (let y = Math.max(q.y0, r.y0); y < Math.min(q.y1, r.y1); y++)
      for (let x = Math.max(q.x0, r.x0); x < Math.min(q.x1, r.x1); x++) f(x, y);
  };
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    clip(cellRect(seed, i, j), (x, y) => { art[y - r.y0][x - r.x0] = false; });
    for (const b of cellBlocks(seed, i, j)) for (const f of b.foot) clip(f, (x, y) => {
      cls[y - r.y0][x - r.x0] = lotOf(b, x, y) ? 'lot' : 'walk';
      block[y - r.y0][x - r.x0] = b.id;
    });
  }
  return { cls, block, art };
}

/** Classes of r, row-major (rows y0..y1-1). */
export function classRaster(seed: string, r: Rect): WorldCls[][] {
  return raster(seed, r).cls;
}

/** Block owning a road cell: the block of the Chebyshev-nearest sidewalk cell; ties go to the smallest id (spec 2.3).
 *  Junction cells follow the same rule. */
export function roadOwner(seed: string, x: number, y: number): string {
  // Search rings in a window around (x, y); a larger window only adds rings further out, so the answer does not
  // depend on the window size as long as the nearest ring is inside it.
  for (let R = Math.max(...ROAD_WIDTHS); ; R *= 2) {
    const ras = raster(seed, { x0: x - R, y0: y - R, x1: x + R + 1, y1: y + R + 1 });
    for (let d = 1; d <= R; d++) {
      let best: string | null = null;
      for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
        if (ras.cls[R + dy][R + dx] !== 'walk') continue;
        const id = ras.block[R + dy][R + dx]!;
        if (best === null || id < best) best = id;
      }
      if (best !== null) return best;
    }
  }
}

/** Block owning any cell: sidewalk / lot cells belong to their block, road cells to roadOwner. */
export function ownerOf(seed: string, x: number, y: number): string {
  const b = blockAt(seed, x, y);
  return b ? b.id : roadOwner(seed, x, y);
}

/** Zebra crossings (CROSSING_LEN cells along the road, the full road width across) intersecting r.
 *  Corridors are found on r padded by ANALYSIS_PAD. A crossing is drawn at a corridor end whose next cell is a
 *  junction (road in no corridor) when the corridor runs on for >= CROSSING_MIN_RUN cells; whether and where is
 *  hashed on the junction's first world cell. Locality: a cell's corridor status depends only on runs of at most the
 *  widest road through it, and every cell a crossing intersecting r looks at lies within CROSSING_MIN_RUN of r, so
 *  the pad (>= widest road + CROSSING_MIN_RUN) keeps all of them unaffected by the raster edge; ends cut by the
 *  raster edge are never junctions inside that zone. */
export function crossingsIn(seed: string, r: Rect): WCrossing[] {
  const P = ANALYSIS_PAD, pr: Rect = { x0: r.x0 - P, y0: r.y0 - P, x1: r.x1 + P, y1: r.y1 + P };
  const ras = raster(seed, pr);
  const rows = ras.cls.length, cols = rows ? ras.cls[0].length : 0;
  const segs = findSegs(ras.cls, (_a, w) => ROAD_WIDTHS.includes(w));
  const inSeg: boolean[][] = Array.from({ length: rows }, () => Array<boolean>(cols).fill(false));
  for (const s of segs) for (let p = s.a; p < s.b; p++) for (let k = s.band0; k < s.band1; k++) {
    if (s.axis === 'h') inSeg[k][p] = true; else inSeg[p][k] = true;
  }
  const out: WCrossing[] = [];
  for (const s of segs) {
    if (s.b - s.a < CROSSING_MIN_RUN) continue;
    const n = s.axis === 'h' ? cols : rows;
    const at = (p: number, k: number): [number, number] => (s.axis === 'h' ? [p, k] : [k, p]);   // raster [x, y]
    for (const end of ['a', 'b'] as const) {
      const j = end === 'a' ? s.a - 1 : s.b;                  // first cell beyond the end
      if (j < 0 || j >= n) continue;                          // cut by the raster edge: not a real end
      let junction = true;
      for (let k = s.band0; k < s.band1 && junction; k++) {
        const [x, y] = at(j, k);
        junction = ras.cls[y][x] === 'road' && !inSeg[y][x];
      }
      if (!junction) continue;
      const [jx, jy] = at(j, s.band0);
      const wx = jx + pr.x0, wy = jy + pr.y0;                 // the junction's first world cell
      const [cx, cy] = at(end === 'a' ? s.a : s.b - 1, s.band0);
      const kind = ras.art[cy][cx] ? 'arterial' : 'street';
      if (hash01(seed, 'xing', wx, wy, s.axis) >= CROSSING_CHANCE[kind]) continue;
      const gap = hashInt(seed, CROSSING_GAP[0], CROSSING_GAP[1], 'xgap', wx, wy, s.axis);
      const p = end === 'a' ? s.a + gap : s.b - CROSSING_LEN - gap;
      const o = s.axis === 'h' ? pr.x0 : pr.y0, ob = s.axis === 'h' ? pr.y0 : pr.x0;
      const c: WCrossing = { axis: s.axis, band0: s.band0 + ob, band1: s.band1 + ob, at: p + o };
      const cr = s.axis === 'h'
        ? { x0: c.at, x1: c.at + CROSSING_LEN, y0: c.band0, y1: c.band1 }
        : { x0: c.band0, x1: c.band1, y0: c.at, y1: c.at + CROSSING_LEN };
      if (cr.x0 < r.x1 && r.x0 < cr.x1 && cr.y0 < r.y1 && r.y0 < cr.y1) out.push(c);
    }
  }
  return out.sort((p, q) => (p.axis < q.axis ? -1 : p.axis > q.axis ? 1 : p.band0 - q.band0 || p.at - q.at));
}
