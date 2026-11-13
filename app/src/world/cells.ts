// Per-cell classes of the world (road / walk / lot), ownership of road cells by blocks, and zebra crossings.
// Everything is a pure function of (seed, coordinates): rasters are painted from the blocks of the arterial cells
// that can cover them, and every crossing decision is keyed on world coordinates.
import { hash01, hashInt } from './hash';
import { cellAt, cellRect } from './arterials';
import { blockAt, cellBlocks, lotOf } from './blocks';
import { roundaboutsIn, roundaboutAt, islandBlock } from './roundabout';
import { ARTERIAL_SPACING, CROSSING_CHANCE, CROSSING_MIN_RUN, CROSSING_LEN, CROSSING_GAP, ANALYSIS_PAD, ROAD_WIDTHS, STREET_WIDTH } from './config';
import { findSegs, type Seg } from '../gen/layout';
import type { CellClass } from '../gen/types';
import type { Rect, WorldCell, WorldCls, WCrossing } from './types';

/** Class of one world cell; road cells outside every arterial cell are arterial. */
export function worldCell(seed: string, x: number, y: number): WorldCell {
  const b = blockAt(seed, x, y);
  if (b) return { cls: lotOf(b, x, y) ? 'lot' : 'walk', block: b.id };
  return cellAt(seed, x, y) ? { cls: 'road' } : { cls: 'road', arterial: true };
}

interface Raster { cls: WorldCls[][]; block: (string | null)[][]; art: boolean[][] }

/** Arterial cell index range that can cover a point of r: the jitter never moves a cell edge by a whole spacing, so
 *  one spacing of slack on each side is enough. */
export function cellRange(r: Rect): { i0: number; i1: number; j0: number; j1: number } {
  return {
    i0: Math.floor(r.x0 / ARTERIAL_SPACING.x) - 1, i1: Math.floor((r.x1 - 1) / ARTERIAL_SPACING.x) + 1,
    j0: Math.floor(r.y0 / ARTERIAL_SPACING.y) - 1, j1: Math.floor((r.y1 - 1) / ARTERIAL_SPACING.y) + 1,
  };
}

/** Paints r from the blocks of every arterial cell that cellAt could return for a point of r. */
function raster(seed: string, r: Rect): Raster {
  const W = r.x1 - r.x0, H = r.y1 - r.y0;
  const cls: WorldCls[][] = Array.from({ length: H }, () => Array<WorldCls>(W).fill('road'));
  const block: (string | null)[][] = Array.from({ length: H }, () => Array<string | null>(W).fill(null));
  const art: boolean[][] = Array.from({ length: H }, () => Array<boolean>(W).fill(true));
  const { i0, i1, j0, j1 } = cellRange(r);
  const clip = (q: Rect, f: (x: number, y: number) => void) => {
    for (let y = Math.max(q.y0, r.y0); y < Math.min(q.y1, r.y1); y++)
      for (let x = Math.max(q.x0, r.x0); x < Math.min(q.x1, r.x1); x++) f(x, y);
  };
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    clip(cellRect(seed, i, j), (x, y) => { art[y - r.y0][x - r.x0] = false; });
    for (const b of cellBlocks(seed, i, j)) for (const f of b.foot) clip(f, (x, y) => {
      if (b.cut?.some(q => x >= q.x0 && x < q.x1 && y >= q.y0 && y < q.y1)) return;   // a roundabout's road
      cls[y - r.y0][x - r.x0] = lotOf(b, x, y) ? 'lot' : 'walk';
      block[y - r.y0][x - r.x0] = b.id;
    });
  }
  // roundabouts' centre islands lie on the arterials, outside every cell
  for (const rb of roundaboutsIn(seed, r)) {
    const b = islandBlock(seed, rb);
    clip(rb.island, (x, y) => {
      cls[y - r.y0][x - r.x0] = lotOf(b, x, y) ? 'lot' : 'walk';
      block[y - r.y0][x - r.x0] = b.id;
    });
  }
  return { cls, block, art };
}

/** Per cell of r (row-major): a road cell of a roundabout's R (spec 2.5). The centre island's cells are a block, so
 *  false. */
export function rbMask(seed: string, r: Rect): boolean[][] {
  return maskOn(seed, r, () => raster(seed, r).cls);
}

/** rbMask on the classes of r (computed only when a roundabout reaches r). */
function maskOn(seed: string, r: Rect, classes: () => WorldCls[][]): boolean[][] {
  const W = r.x1 - r.x0, H = r.y1 - r.y0;
  const out: boolean[][] = Array.from({ length: H }, () => Array<boolean>(W).fill(false));
  const rbs = roundaboutsIn(seed, r);
  if (!rbs.length) return out;
  const cls = classes();
  for (const rb of rbs) {
    for (let y = Math.max(rb.R.y0, r.y0); y < Math.min(rb.R.y1, r.y1); y++)
      for (let x = Math.max(rb.R.x0, r.x0); x < Math.min(rb.R.x1, r.x1); x++)
        if (cls[y - r.y0][x - r.x0] === 'road') out[y - r.y0][x - r.x0] = true;
  }
  return out;
}

/** Classes for findSegs: a roundabout's road (mask) counts as non-road, so corridors stop at the edge of R and lane
 *  lines, crossings and window segments never run into it (spec 2.5). */
export function segClasses<C extends WorldCls | CellClass>(cls: C[][], mask: boolean[][]): (C | 'walk')[][] {
  return cls.map((row, y) => row.map((c, x) => (c === 'road' && mask[y][x] ? 'walk' : c)));
}

/** Classes of r, row-major (rows y0..y1-1). */
export function classRaster(seed: string, r: Rect): WorldCls[][] {
  return raster(seed, r).cls;
}

/** Block id per cell of r (null on road), row-major (rows y0..y1-1). */
export function blockRaster(seed: string, r: Rect): (string | null)[][] {
  return raster(seed, r).block;
}

/** Ring search of roadOwner on a raster: the smallest block id on the nearest ring (Chebyshev distance 1..maxD around
 *  raster cell (x, y)) holding a sidewalk cell, or null if no ring up to maxD has one. The rings must lie inside ras. */
function ringOwner(ras: Raster, x: number, y: number, maxD: number): string | null {
  for (let d = 1; d <= maxD; d++) {
    let best: string | null = null;
    for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== d || ras.cls[y + dy][x + dx] !== 'walk') continue;
      const id = ras.block[y + dy][x + dx]!;
      if (best === null || id < best) best = id;
    }
    if (best !== null) return best;
  }
  return null;
}

/** Block owning a road cell: the block of the Chebyshev-nearest sidewalk cell; ties go to the smallest id (spec 2.3).
 *  Junction cells follow the same rule. */
export function roadOwner(seed: string, x: number, y: number): string {
  // Search rings in a window around (x, y); a larger window only adds rings further out, so the answer does not
  // depend on the window size as long as the nearest ring is inside it.
  for (let R = Math.max(...ROAD_WIDTHS); ; R *= 2) {
    const o = ringOwner(raster(seed, { x0: x - R, y0: y - R, x1: x + R + 1, y1: y + R + 1 }), R, R, R);
    if (o !== null) return o;
  }
}

/** Block owning any cell: sidewalk / lot cells belong to their block, road cells to roadOwner. */
export function ownerOf(seed: string, x: number, y: number): string {
  const b = blockAt(seed, x, y);
  return b ? b.id : roadOwner(seed, x, y);
}

/** Owner block id of every cell of r (row-major); equal to ownerOf cell by cell, but resolved on one raster of r
 *  padded by ANALYSIS_PAD (roadOwner's ring search out to the pad, roadOwner itself beyond it). */
export function ownerRaster(seed: string, r: Rect): string[][] {
  const P = ANALYSIS_PAD, ras = raster(seed, { x0: r.x0 - P, y0: r.y0 - P, x1: r.x1 + P, y1: r.y1 + P });
  const out: string[][] = [];
  for (let y = P; y < P + r.y1 - r.y0; y++) {
    const row: string[] = [];
    for (let x = P; x < P + r.x1 - r.x0; x++)
      row.push(ras.block[y][x] ?? ringOwner(ras, x, y, P) ?? roadOwner(seed, x - P + r.x0, y - P + r.y0));
    out.push(row);
  }
  return out;
}

/** Name of a junction's arm by the corridor it ends (end 'a': the corridor's west / north end). */
const armName = (axis: 'h' | 'v', end: 'a' | 'b'): string => (axis === 'h' ? (end === 'a' ? '西臂' : '东臂') : end === 'a' ? '北臂' : '南臂');

/** Zebra crossings (CROSSING_LEN cells along the road, the full road width across) intersecting r.
 *  Corridors are found on r padded by ANALYSIS_PAD. A crossing is drawn at a corridor end whose next cell is a
 *  junction (road in no corridor) when the corridor runs on for >= CROSSING_MIN_RUN cells; whether and where is
 *  hashed on the junction's first world cell. A junction also needs a cross road leaving it (>= STREET_WIDTH road
 *  cells beyond the band). A corridor running into a roundabout's road (rbMask: its R is no corridor) ends at a
 *  junction without a cross road; whether and where is hashed on the roundabout (i, j), the axis and the end (v0.8.3). Locality: a cell's corridor status depends only on runs of at most the widest road
 *  through it. A crossing intersecting r, its gap and its junction cells reach at most ~4 cells beyond r and the runs
 *  across them at most the widest road (17) further, 21 < ANALYSIS_PAD = 24, so every run they depend on lies inside
 *  the raster, and a corridor run toward the raster edge keeps >= 20 cells >= CROSSING_MIN_RUN; the
 *  decisions for crossings intersecting r are therefore unaffected by the raster edge, and ends cut by the raster
 *  edge are never junctions near r. */
export function crossingsIn(seed: string, r: Rect): WCrossing[] {
  const P = ANALYSIS_PAD, pr: Rect = { x0: r.x0 - P, y0: r.y0 - P, x1: r.x1 + P, y1: r.y1 + P };
  const ras = raster(seed, pr), rbm = maskOn(seed, pr, () => ras.cls);
  const rows = ras.cls.length, cols = rows ? ras.cls[0].length : 0;
  const segs = findSegs(segClasses(ras.cls, rbm), (_a, w) => ROAD_WIDTHS.includes(w));
  const inSeg: boolean[][] = Array.from({ length: rows }, () => Array<boolean>(cols).fill(false));
  for (const s of segs) for (let p = s.a; p < s.b; p++) for (let k = s.band0; k < s.band1; k++) {
    if (s.axis === 'h') inSeg[k][p] = true; else inSeg[p][k] = true;
  }
  const out: WCrossing[] = [];
  // a crossing of corridor s at raster position p (along the corridor), kept when it intersects r
  const add = (s: Seg, p: number, why: string) => {
    const o = s.axis === 'h' ? pr.x0 : pr.y0, ob = s.axis === 'h' ? pr.y0 : pr.x0;
    const c: WCrossing = { axis: s.axis, band0: s.band0 + ob, band1: s.band1 + ob, at: p + o, why };
    const cr = s.axis === 'h'
      ? { x0: c.at, x1: c.at + CROSSING_LEN, y0: c.band0, y1: c.band1 }
      : { x0: c.band0, x1: c.band1, y0: c.at, y1: c.at + CROSSING_LEN };
    if (cr.x0 < r.x1 && r.x0 < cr.x1 && cr.y0 < r.y1 && r.y0 < cr.y1) out.push(c);
  };
  for (const s of segs) {
    if (s.b - s.a < CROSSING_MIN_RUN) continue;
    const n = s.axis === 'h' ? cols : rows;
    const at = (p: number, k: number): [number, number] => (s.axis === 'h' ? [p, k] : [k, p]);   // raster [x, y]
    for (const end of ['a', 'b'] as const) {
      const j = end === 'a' ? s.a - 1 : s.b;                  // first cell beyond the end
      if (j < 0 || j >= n) continue;                          // cut by the raster edge: not a real end
      // a corridor running into a roundabout (spec 2.5): a junction without a cross road, one draw per arm
      let rb = true;
      for (let k = s.band0; k < s.band1 && rb; k++) { const [x, y] = at(j, k); rb = rbm[y][x]; }
      if (rb) {
        const [x, y] = at(j, s.band0), q = roundaboutAt(seed, x + pr.x0, y + pr.y0)!;
        const h = hash01(seed, 'xing', 'rb', q.i, q.j, s.axis, end);
        if (h >= CROSSING_CHANCE.arterial) continue;
        const gap = hashInt(seed, CROSSING_GAP[0], CROSSING_GAP[1], 'xgap', 'rb', q.i, q.j, s.axis, end);
        add(s, end === 'a' ? s.a + gap : s.b - CROSSING_LEN - gap,
          `横道：环岛 r${q.i},${q.j} 的${armName(s.axis, end)}（${s.axis === 'h' ? '横向' : '竖向'}主干道在这里通进环岛），散列 ${h.toFixed(2)} < 概率 ${CROSSING_CHANCE.arterial}，离环岛 ${gap} 格`);
        continue;
      }
      let junction = true;
      for (let k = s.band0; k < s.band1 && junction; k++) {
        const [x, y] = at(j, k);
        junction = ras.cls[y][x] === 'road' && !inSeg[y][x];
      }
      // a cross road must leave the junction: >= STREET_WIDTH road cells beyond one side of the band (a jogged
      // street's widening is only JOG_STEP cells wide, so a jog is no junction)
      const beyond = (k: number, dk: number) => {
        let n = 0;
        for (; n < STREET_WIDTH; n++, k += dk) {
          const [x, y] = at(j, k);
          if (x < 0 || y < 0 || x >= cols || y >= rows || ras.cls[y][x] !== 'road') break;
        }
        return n;
      };
      if (!junction || (beyond(s.band0 - 1, -1) < STREET_WIDTH && beyond(s.band1, 1) < STREET_WIDTH)) continue;
      const [jx, jy] = at(j, s.band0);
      const wx = jx + pr.x0, wy = jy + pr.y0;                 // the junction's first world cell
      const [cx, cy] = at(end === 'a' ? s.a : s.b - 1, s.band0);
      const kind = ras.art[cy][cx] ? 'arterial' : 'street';
      const h = hash01(seed, 'xing', wx, wy, s.axis);
      if (h >= CROSSING_CHANCE[kind]) continue;
      const gap = hashInt(seed, CROSSING_GAP[0], CROSSING_GAP[1], 'xgap', wx, wy, s.axis);
      add(s, end === 'a' ? s.a + gap : s.b - CROSSING_LEN - gap,
        `横道：路口 (${wx},${wy}) 的${armName(s.axis, end)}（${kind === 'arterial' ? '主干道' : '支路'}），散列 ${h.toFixed(2)} < 概率 ${CROSSING_CHANCE[kind]}，离路口 ${gap} 格`);
    }
  }
  return out.sort((p, q) => (p.axis < q.axis ? -1 : p.axis > q.axis ? 1 : p.band0 - q.band0 || p.at - q.at));
}
