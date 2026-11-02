// Main block planning: south frontage row, optional north row, alleys, plaza, courtyard.
// In this 3/4 view every facade faces south (towards the viewer). So the south frontage is the lively
// street front; north-row buildings show their roofs to the north street and their fronts to the courtyard.
import { Rng } from './rng';
import type { Layout } from './layout';
import type { BuildingPlan } from './buildings';
import { pack } from './pack';
import { SceneBuilder, rect } from './place';
import { TILE } from './types';

const PART_NAMES: Record<string, string> = { roof: '屋顶', mid: '中间层', ground: '底层', whole: '整体精灵' };

export interface PlacedBuilding { plan: BuildingPlan; cx: number; cy: number; side: 'S' | 'N'; /** why the packer put it here */ why: string }
export interface Zone { kind: 'alley' | 'plaza' | 'pocket'; x0: number; y0: number; x1: number; y1: number; why: string }   // cells, half-open

export interface BlockPlan {
  buildings: PlacedBuilding[];
  zones: Zone[];
  /** free interior cells after buildings / zones (the courtyard); includes ground hidden behind buildings */
  yard: boolean[][];
  /** yard cells covered by the upper part of a building sprite (behind the building, seen only in ghost view) */
  hidden: boolean[][];
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
  const nAlley = r.choose('block.alleys', { W }, { weights: [[0, 3], [1, 4], [2, 1]] as const });
  for (let i = 0; i < nAlley; i++) {
    const w = r.int(1, 2), x = xs[r.int(Math.floor(W * 0.2), Math.floor(W * 0.8))];
    const y1 = (yb.get(x) ?? L.by1 - 1) + 1;
    // the inner end stays inside the block (notched blocks are short in some columns)
    const y0 = Math.max(y1 - r.int(5, Math.max(5, Math.floor((L.by1 - L.by0) * 0.6))), ...[x, x + w - 1].map(c => yt.get(c) ?? L.by0));
    carve({ kind: 'alley', x0: x, y0, x1: x + w, y1, why: `穿过南侧临街面的巷子（本街区抽到 ${nAlley} 条）：通往内院，打断连续立面` });
  }
  if (r.choose('block.plaza', {}, { p: 0.45 })) {
    const w = r.int(5, 8), x = xs[r.int(0, Math.max(0, W - w))];
    const y1 = (yb.get(x) ?? L.by1 - 1) + 1;
    if (!zones.some(z => z.x0 < x + w + 1 && x - 1 < z.x1)) carve({ kind: 'plaza', x0: x, y0: y1 - r.int(4, 6), x1: x + w, y1, why: '临街小广场（45% 的街区有）：立面后退形成的公共空间' });
  }
  // ---- pack buildings: south frontage first, then rows behind, side streets, north edge ----
  const mix = r.choose('block.mix', {}, { weights: [[{ modular: 3, single: 2 }, 2], [{ modular: 1, single: 2 }, 1], [{ modular: 3, single: 1 }, 1]] as const });
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
  const buildings: PlacedBuilding[] = placed.map(p => ({ plan: p.plan, cx: p.cx, cy: p.cy, side: (p.cy + p.plan.h - 1 === yb.get(p.cx) ? 'S' : 'N') as 'S' | 'N', why: p.why }));
  // the ground behind a building (sprite rows above its roof-sized footprint) is yard too, just hidden
  const hidden = yard.map(row => row.map(() => false));
  for (const { plan: b, cx, cy } of placed) for (let y = cy; y < cy + b.h - b.foot; y++) for (let x = cx; x < cx + b.w; x++)
    if (L.inP[y]?.[x]) { yard[y][x] = true; hidden[y][x] = true; }
  return { buildings, zones, yard, hidden, yb, yt };
}

/** emit building sprites; the solid footprint is the bottom `foot` rows; doors keep a clear path to the street */
export function emitBuildings(L: Layout, plan: BlockPlan, sb: SceneBuilder, block: 'main' | 'neigh') {
  for (const pb of plan.buildings) {
    const { plan: b, cx, cy } = pb;
    const x0 = cx * TILE, y0 = cy * TILE, bottom = (cy + b.h) * TILE, solid = bottom - b.foot * TILE;
    const gid = sb.group('bld', pb.why, { id: b.id, anchor: { kind: 'slot', ref: `${block}:${cx},${cy + b.h - 1}`, x: x0 + b.w * TILE / 2, y: bottom } });
    sb.buildings.push({ gid, id: b.id, label: b.label, front: b.front, block, side: pb.side, rect: rect(x0, y0, x0 + b.w * TILE, bottom), solid: rect(x0, solid, x0 + b.w * TILE, bottom),
      doors: b.doors.map(d => ({ x: x0 + d, y: bottom })), reason: pb.why });
    for (const p of b.parts) {
      const o = sb.putAt(p.key, x0 + p.dx, y0 + p.dy, 'building', { force: true, occupy: false, foot: bottom - 1, sub: p.sub, gid, why: `${b.label} 的${PART_NAMES[p.role]}` });
      if (o) o.solid = solid;
    }
    sb.occupy(rect(x0, solid, x0 + b.w * TILE, bottom), 'building');
    for (const [di, d] of b.doors.entries()) {
      // path from the door down to the curb (or 2 rows into a courtyard)
      let depth = 0;
      const dc = Math.floor((x0 + d) / TILE);
      for (let y = cy + b.h; y < L.rows && depth < 5; y++) { const c = L.cls[y][dc]; if (c === 'road' || (c !== 'walk' && c !== 'nwalk' && depth >= 2)) break; depth++; }
      sb.clear(rect(x0 + d - 12, bottom, x0 + d + 12, bottom + Math.max(14, depth * TILE - 2)), 'door', `${b.id} 的门${b.doors.length > 1 ? di + 1 : ''}前通道：从门口到路缘保持畅通`, gid);
    }
  }
}
