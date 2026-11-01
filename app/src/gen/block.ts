// Main block planning: south frontage row, optional north row, alleys, plaza, courtyard.
// In this 3/4 view every facade faces south (towards the viewer). So the south frontage is the lively
// street front; north-row buildings show their roofs to the north street and their fronts to the courtyard.
import { Rng } from './rng';
import type { Layout } from './layout';
import type { BuildingPlan } from './buildings';
import { pack } from './pack';
import { SceneBuilder, rect } from './place';
import { TILE } from './types';

export interface PlacedBuilding { plan: BuildingPlan; cx: number; cy: number; side: 'S' | 'N' }
export interface Zone { kind: 'alley' | 'plaza' | 'pocket'; x0: number; y0: number; x1: number; y1: number }   // cells, half-open

export interface BlockPlan {
  buildings: PlacedBuilding[];
  zones: Zone[];
  /** free interior cells after buildings / zones (the courtyard) */
  yard: boolean[][];
  /** per column of the main interior: bottom/top interior rows */
  yb: Map<number, number>; yt: Map<number, number>;
}

export function planMainBlock(L: Layout, r0: Rng): BlockPlan {
  const r = r0.fork('block');
  const yb = new Map<number, number>(), yt = new Map<number, number>();
  for (let x = L.bx0; x < L.bx1; x++) {
    let t = -1, b = -1;
    for (let y = L.by0; y < L.by1; y++) if (L.inP[y][x]) { if (t < 0) t = y; b = y; }
    if (t >= 0) { yt.set(x, t); yb.set(x, b); }
  }
  const zones: Zone[] = [];
  const carved = Array.from({ length: L.rows }, () => Array<boolean>(L.cols).fill(false));
  const carve = (z: Zone) => { zones.push(z); for (let y = z.y0; y < z.y1; y++) for (let x = z.x0; x < z.x1; x++) if (carved[y]?.[x] !== undefined) carved[y][x] = true; };
  // ---- frontage openings carved before packing: alleys through the block, at most one small plaza ----
  const xs = [...yb.keys()].sort((p, q) => p - q);
  const W = xs.length;
  const nAlley = r.weighted([[0, 3], [1, 4], [2, 1]] as const);
  for (let i = 0; i < nAlley; i++) {
    const w = r.int(1, 2), x = xs[r.int(Math.floor(W * 0.2), Math.floor(W * 0.8))];
    const y1 = (yb.get(x) ?? L.by1 - 1) + 1, y0 = y1 - r.int(5, Math.max(5, Math.floor((L.by1 - L.by0) * 0.6)));
    carve({ kind: 'alley', x0: x, y0, x1: x + w, y1 });
  }
  if (r.chance(0.45)) {
    const w = r.int(5, 8), x = xs[r.int(0, Math.max(0, W - w))];
    const y1 = (yb.get(x) ?? L.by1 - 1) + 1;
    if (!zones.some(z => z.x0 < x + w + 1 && x - 1 < z.x1)) carve({ kind: 'plaza', x0: x, y0: y1 - r.int(4, 6), x1: x + w, y1 });
  }
  // ---- pack buildings: south frontage first, then rows behind, side streets, north edge ----
  const mix = r.weighted([[{ modular: 3, single: 2 }, 2], [{ modular: 1, single: 2 }, 1], [{ modular: 3, single: 1 }, 1]] as const);
  const { placed, yard } = pack({
    cols: L.cols, rows: L.rows, buildable: (x, y) => L.inP[y][x] && !carved[y][x], mix, minH: 8,
    gapAfter: [[0, 6], [1, 2], [2, 1]], pairChance: 0.4,
    // only buildings that face the street (sidewalk right below the facade) may be shops
    frontFilter: (x0, w, bottom) => {
      let street = true;
      for (let x = x0; x < x0 + w; x++) if (L.cls[bottom + 1]?.[x] !== 'walk' && !(L.cls[bottom + 2]?.[x] === 'walk' && L.inP[bottom + 1]?.[x])) street = false;
      return street ? null : ['condo', 'house'];
    },
  }, r);
  const buildings: PlacedBuilding[] = placed.map(p => ({ plan: p.plan, cx: p.cx, cy: p.cy, side: (p.cy + p.plan.h - 1 === yb.get(p.cx) ? 'S' : 'N') as 'S' | 'N' }));
  for (const z of zones) if (z.kind === 'alley') for (let y = z.y0; y < z.y1; y++) for (let x = z.x0; x < z.x1; x++) if (L.inP[y]?.[x]) yard[y][x] = true;
  return { buildings, zones, yard, yb, yt };
}

/** emit building sprites; returns keep-clear zones for doors */
export function emitBuildings(plan: BlockPlan, sb: SceneBuilder) {
  for (const pb of plan.buildings) {
    const { plan: b, cx, cy } = pb;
    const x0 = cx * TILE, y0 = cy * TILE, bottom = (cy + b.h) * TILE;
    for (const p of b.parts) {
      sb.putAt(p.key, x0 + p.dx, y0 + p.dy, 'building', { force: true, occupy: false, foot: bottom - 1, sub: p.sub, group: b.id });
    }
    sb.occupy(rect(x0, y0, x0 + b.w * TILE, bottom), 'building');
    for (const d of b.doors) sb.clear(rect(x0 + d - 12, bottom, x0 + d + 12, bottom + 14), 'door');
  }
}
