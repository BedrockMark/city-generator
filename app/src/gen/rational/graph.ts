// Stage 5: functional connectivity graph of a finished map.
//
// The ground is rasterised at 4 px. A cell is walkable when its ground is sidewalk / lot (driveways and zebras
// count, the carriageway does not) and no building footprint or object footprint covers it. Walkable cells are
// eroded by one cell (a person needs a gap of ~12 px) and split into connected components. A component is
// "rooted" when it reaches the street (sidewalk next to the road), the map edge (the city goes on) or a door.
//
// Places are the purposeful areas (yard allocation, alleys, plazas, islands; the street; leftover lot), and two
// places are linked when walkable cells of both touch along >= 8 px. Doors and usable objects hang off the place
// and component of their access cells.
import { inRect, type World, type WObj } from './world';
import type { PxRect, ZoneRec } from '../types';

export const G = 4;
/** classes that do not block walking (flat on the ground, or overhead) */
const FLAT = new Set(['manhole', 'person']);

export type Root = 'street' | 'edge' | 'door';

export interface Place { id: number; kind: string; zone?: ZoneRec; cells: number; comps: Set<number> }

export interface Graph {
  gw: number; gh: number;
  /** walkable ground not covered by anything (raw) */
  free: Uint8Array;
  /** free and at least one cell away from obstacles: where a person fits */
  walk: Uint8Array;
  /** component id per cell (-1 = not walkable) */
  comp: Int32Array;
  compRoots: Set<Root>[];
  compSize: number[];
  /** place id per cell (-1 = none) */
  place: Int32Array;
  places: Place[];
  /** "a,b" (a < b) -> shared walkable border in px */
  links: Map<string, number>;
  doors: { bid: string; x: number; y: number; block: string; comp: number; place: number }[];
}

const ZONE_PLACE_LAYERS = new Set(['yard', 'block']);

export function buildGraph(w: World, opts: { ignore?: Set<string> } = {}): Graph {
  const gw = Math.ceil(w.W / G), gh = Math.ceil(w.H / G);
  const N = gw * gh;
  const free = new Uint8Array(N);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    const g = w.ground(x * G + G / 2, y * G + G / 2);
    free[y * gw + x] = g === 'walk' || g === 'lot' ? 1 : 0;
  }
  const block = (r: PxRect) => {
    const x0 = Math.max(0, Math.floor(r.x0 / G)), x1 = Math.min(gw, Math.ceil(r.x1 / G));
    const y0 = Math.max(0, Math.floor(r.y0 / G)), y1 = Math.min(gh, Math.ceil(r.y1 / G));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) free[y * gw + x] = 0;
  };
  for (const r of w.walls) block(r);
  for (const o of w.objs) if (o.fp && !FLAT.has(o.cls) && !opts.ignore?.has(o.id)) block(o.fp);
  // erosion: a person needs the neighbouring cells free too
  const walk = new Uint8Array(N);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    if (!free[y * gw + x]) continue;
    let ok = 1;
    for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue;   // the map edge is not an obstacle
      if (!free[yy * gw + xx]) { ok = 0; break; }
    }
    walk[y * gw + x] = ok;
  }
  // components
  const comp = new Int32Array(N).fill(-1);
  const compRoots: Set<Root>[] = [], compSize: number[] = [];
  const q = new Int32Array(N);
  for (let s = 0; s < N; s++) {
    if (!walk[s] || comp[s] >= 0) continue;
    const id = compRoots.length; compRoots.push(new Set()); compSize.push(0);
    let h = 0, t = 0; q[t++] = s; comp[s] = id;
    while (h < t) {
      const c = q[h++]; compSize[id]++;
      const x = c % gw, y = (c - x) / gw;
      if (x === 0 || y === 0 || x === gw - 1 || y === gh - 1) compRoots[id].add('edge');
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue;
        const n = yy * gw + xx;
        if (walk[n] && comp[n] < 0) { comp[n] = id; q[t++] = n; }
      }
    }
  }
  // street: sidewalk within 16 px of the road
  const nearRoad = (px: number, py: number) => [[0, 0], [16, 0], [-16, 0], [0, 16], [0, -16]].some(([dx, dy]) => w.ground(px + dx, py + dy) === 'road');
  for (let c = 0; c < N; c++) {
    if (comp[c] < 0 || compRoots[comp[c]].has('street')) continue;
    const x = (c % gw) * G + G / 2, y = Math.floor(c / gw) * G + G / 2;
    if (w.ground(x, y) === 'walk' && nearRoad(x, y)) compRoots[comp[c]].add('street');
  }
  // places
  const places: Place[] = [];
  const place = new Int32Array(N).fill(-1);
  const zonePlaces = w.zones.filter(z => ZONE_PLACE_LAYERS.has(z.layer));
  for (const z of zonePlaces) {
    const id = places.length; places.push({ id, kind: z.kind, zone: z, cells: 0, comps: new Set() });
    for (let y = Math.floor(z.rect.y0 / G); y < Math.ceil(z.rect.y1 / G); y++) for (let x = Math.floor(z.rect.x0 / G); x < Math.ceil(z.rect.x1 / G); x++) {
      if (x < 0 || y < 0 || x >= gw || y >= gh) continue;
      const n = y * gw + x; if (place[n] < 0) place[n] = id;
    }
  }
  const street = places.length; places.push({ id: street, kind: 'street', cells: 0, comps: new Set() });
  const lot = places.length; places.push({ id: lot, kind: 'lot', cells: 0, comps: new Set() });
  for (let c = 0; c < N; c++) {
    if (place[c] >= 0) continue;
    const g = w.ground((c % gw) * G + G / 2, Math.floor(c / gw) * G + G / 2);
    if (g === 'walk') place[c] = street; else if (g === 'lot') place[c] = lot;
  }
  for (let c = 0; c < N; c++) if (place[c] >= 0) { places[place[c]].cells++; if (comp[c] >= 0) places[place[c]].comps.add(comp[c]); }
  // links between places across walkable borders
  const links = new Map<string, number>();
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    const a = y * gw + x; if (!walk[a]) continue;
    for (const n of [x + 1 < gw ? a + 1 : -1, y + 1 < gh ? a + gw : -1]) {
      if (n < 0 || !walk[n] || place[a] < 0 || place[n] < 0 || place[a] === place[n]) continue;
      const k = place[a] < place[n] ? `${place[a]},${place[n]}` : `${place[n]},${place[a]}`;
      links.set(k, (links.get(k) ?? 0) + G);
    }
  }
  for (const [k, v] of links) if (v < 8) links.delete(k);
  // doors: the walkable cell right in front of the door
  const doors = w.doors.map(d => {
    const c = accessCell({ gw, gh, walk, comp } as Graph, { x0: d.x - 8, y0: d.y, x1: d.x + 8, y1: d.y + 16 });
    return { ...d, comp: c >= 0 ? comp[c] : -1, place: c >= 0 ? place[c] : -1 };
  });
  for (const d of doors) if (d.comp >= 0) compRoots[d.comp].add('door');
  return { gw, gh, free, walk, comp, compRoots, compSize, place, places, links, doors };
}

/** first walkable cell inside the rect (scanning from its centre outwards), -1 if none */
export function accessCell(g: Pick<Graph, 'gw' | 'gh' | 'walk' | 'comp'>, r: PxRect): number {
  const x0 = Math.max(0, Math.floor(r.x0 / G)), x1 = Math.min(g.gw, Math.ceil(r.x1 / G));
  const y0 = Math.max(0, Math.floor(r.y0 / G)), y1 = Math.min(g.gh, Math.ceil(r.y1 / G));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  let best = -1, bd = Infinity;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const n = y * g.gw + x;
    if (!g.walk[n]) continue;
    const d = (x - cx) ** 2 + (y - cy) ** 2;
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

/** components a person can stand in next to the object (ring of `reach` px around its footprint) */
export function objectComps(g: Graph, o: WObj, reach = 12): Set<number> {
  const out = new Set<number>();
  const r = o.fp ?? { x0: o.fx - 4, y0: o.fy - 4, x1: o.fx + 4, y1: o.fy };
  const x0 = Math.max(0, Math.floor((r.x0 - reach) / G)), x1 = Math.min(g.gw, Math.ceil((r.x1 + reach) / G));
  const y0 = Math.max(0, Math.floor((r.y0 - reach) / G)), y1 = Math.min(g.gh, Math.ceil((r.y1 + reach) / G));
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const c = g.comp[y * g.gw + x]; if (c >= 0) out.add(c); }
  return out;
}

export const rooted = (g: Graph, c: number) => c >= 0 && g.compRoots[c].size > 0;
export const placeAt = (g: Graph, px: number, py: number) => g.place[Math.floor(py / G) * g.gw + Math.floor(px / G)] ?? -1;
export const cellRect = (g: Graph, n: number): PxRect => { const x = (n % g.gw) * G, y = Math.floor(n / g.gw) * G; return { x0: x, y0: y, x1: x + G, y1: y + G }; };
export { inRect };
