// Ground tiles of the world: asphalt, sidewalk / lot paving, centre dashes and zebra crossings.
// Same rules as gen/layout's paintGround / paintWalkCell / roadMarkings, in world coordinates. Every random choice
// is a coordinate hash and every analysis runs on r padded by ANALYSIS_PAD, so two overlapping rects paint identical
// tiles on their overlap.
import { hashPick } from './hash';
import { classRaster, crossingsIn } from './cells';
import { blockAt } from './blocks';
import { ANALYSIS_PAD, CROSSING_LEN, DASH_MIN_RUN, ROAD_WIDTHS } from './config';
import { ASPHALT, autotile, slab, findSegs, zebraTile, dashTile } from '../gen/layout';
import type { TileRef } from '../gen/types';
import type { Rect } from './types';

export interface Ground {
  base: (TileRef | null)[][];
  over: (TileRef | null)[][];
  /** semantic marks on road cells: 'dash', 'zebra' */
  mark: string[][];
}

// 8-neighbourhood in autotile bit order (N, NE, E, SE, S, SW, W, NW = 1 << 0 .. 1 << 7)
const DIRS: [number, number][] = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
// Full mask: every neighbour is "inside" (not road)
const ALL = (1 << DIRS.length) - 1;

/** Ground tiles of r (row-major, rows y0..y1-1). */
export function paintGround(seed: string, r: Rect): Ground {
  const P = ANALYSIS_PAD, pr: Rect = { x0: r.x0 - P, y0: r.y0 - P, x1: r.x1 + P, y1: r.y1 + P };
  const cls = classRaster(seed, pr);
  const rows = pr.y1 - pr.y0, cols = pr.x1 - pr.x0;
  const base: (TileRef | null)[][] = Array.from({ length: rows }, () => Array<TileRef | null>(cols).fill(null));
  const mark: string[][] = Array.from({ length: rows }, () => Array<string>(cols).fill(''));
  const isRoad = (x: number, y: number) => x >= 0 && y >= 0 && x < cols && y < rows && cls[y][x] === 'road';

  // asphalt / paving: sidewalk and lot cells take their block's paving; 47-blob autotile next to road, slabs elsewhere
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const wx = x + pr.x0, wy = y + pr.y0;
    if (cls[y][x] === 'road') { base[y][x] = hashPick(seed, ASPHALT, 'asphalt', wx, wy); continue; }
    let m = 0;
    DIRS.forEach(([dx, dy], i) => { if (!isRoad(x + dx, y + dy)) m |= 1 << i; });
    const b = blockAt(seed, wx, wy);
    if (!b) throw new Error(`world/ground: ${cls[y][x]} cell ${wx},${wy} has no block`);
    base[y][x] = m === ALL ? slab(b.paving, wx, wy) : autotile(b.paving, m);
  }

  // zebra crossings: the world's crossings (already decided per junction arm by crossingsIn)
  for (const c of crossingsIn(seed, pr)) for (let k = c.band0; k < c.band1; k++) for (let j = 0; j < CROSSING_LEN; j++) {
    const [wx, wy] = c.axis === 'h' ? [c.at + j, k] : [k, c.at + j];
    const x = wx - pr.x0, y = wy - pr.y0;
    if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
    base[y][x] = zebraTile(c.axis, j, k - c.band0); mark[y][x] = 'zebra';
  }

  // centre dashes: middle line of each corridor, stopping 1 cell before zebras / segment ends
  for (const s of findSegs(cls, (_a, w) => ROAD_WIDTHS.includes(w))) {
    if (s.b - s.a < DASH_MIN_RUN) continue;
    const mid = s.band0 + Math.floor((s.band1 - s.band0) / 2);
    const at = (p: number): [number, number] => (s.axis === 'h' ? [p, mid] : [mid, p]);
    const zebra = (p: number) => { const [x, y] = at(p); return mark[y]?.[x] === 'zebra'; };
    for (let p = s.a + 1; p < s.b - 1; p++) {
      if (zebra(p) || zebra(p - 1) || zebra(p + 1)) continue;
      const [x, y] = at(p);
      base[y][x] = dashTile(s.axis); mark[y][x] = 'dash';
    }
  }

  const crop = <T>(g: T[][]) => g.slice(P, P + r.y1 - r.y0).map(row => row.slice(P, P + r.x1 - r.x0));
  return {
    base: crop(base),
    over: Array.from({ length: r.y1 - r.y0 }, () => Array<TileRef | null>(r.x1 - r.x0).fill(null)),
    mark: crop(mark),
  };
}
