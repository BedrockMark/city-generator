// Block windows (spec 4): one world block plus its surroundings as a gen Layout, the single-block generator run on it,
// and the ownership filter (spec 2.3) that keeps only the objects and zones on cells the block owns.
import { blockById } from './blocks';
import { classRaster, blockRaster, crossingsIn, ownerOf, ownerRaster } from './cells';
import { paintGround } from './ground';
import { BLOCK_CACHE, CITY_NOVELTY, CROSSING_LEN, ROAD_WIDTHS, SLAB_PERIOD, STREET_WIDTH, WINDOW_MARGIN, WINDOW_SW2, ZONES } from './config';
import { chebDist, findSegs, type Crossing, type Layout, type Seg } from '../gen/layout';

const floorTo = (n: number, m: number) => Math.floor(n / m) * m;
import { generateBase } from '../gen/generate';
import { withDefaults } from '../gen/exp';
import { TILE, type CellClass, type Placed, type PxRect, type Scene, type ZoneRec } from '../gen/types';
import type { BlockRec, Rect } from './types';

/** city mode options; no novelty (spec 3.9: CITY_NOVELTY is fixed) */
export interface CityOptions { prune?: boolean; prefs?: boolean }
/** scene in window coordinates; (ox, oy) = the window's top-left world cell */
export interface BlockScene { scene: Scene; ox: number; oy: number }
export interface BlockWindowLayout { layout: Layout; ox: number; oy: number }

/** The window of block b: its footprint's bounding box grown by `margin`, as a Layout in window coordinates. The
 *  top-left corner is moved out to a multiple of the paving slab period (4 x 2), so slabs the generator repaints in
 *  window coordinates line up with the world's. Only what the block owns is handed to the generator's random
 *  subsystems: road segments are cut to the stretches whose centre line the block owns, crossings are those with a
 *  cell the block owns, and `org` puts world coordinates into the stream labels, so a block's content does not depend
 *  on the margin (window.test.ts). */
export function blockLayout(seed: string, b: BlockRec, margin = WINDOW_MARGIN): BlockWindowLayout {
  const bx0 = Math.min(...b.foot.map(f => f.x0)), by0 = Math.min(...b.foot.map(f => f.y0));
  const bx1 = Math.max(...b.foot.map(f => f.x1)), by1 = Math.max(...b.foot.map(f => f.y1));
  const r: Rect = { x0: floorTo(bx0 - margin, SLAB_PERIOD[0]), y0: floorTo(by0 - margin, SLAB_PERIOD[1]), x1: bx1 + margin, y1: by1 + margin };
  const ox = r.x0, oy = r.y0, cols = r.x1 - r.x0, rows = r.y1 - r.y0;
  const wcls = classRaster(seed, r), wblk = blockRaster(seed, r);

  // other blocks become neighbour regions, numbered in id order
  const others = [...new Set(wblk.flat().filter((id): id is string => id !== null && id !== b.id))].sort();
  const regionOf = new Map(others.map((id, i) => [id, i]));
  const cls: CellClass[][] = [], inP: boolean[][] = [], region: number[][] = [], road: boolean[][] = [];
  let lx0 = cols, ly0 = rows, lx1 = 0, ly1 = 0;
  for (let y = 0; y < rows; y++) {
    cls.push([]); inP.push([]); region.push([]); road.push([]);
    for (let x = 0; x < cols; x++) {
      const c = wcls[y][x], id = wblk[y][x], own = id === b.id;
      cls[y].push(c === 'road' ? 'road' : own ? c : c === 'lot' ? 'nlot' : 'nwalk');
      const lot = own && c === 'lot';
      inP[y].push(lot);
      region[y].push(id !== null && !own ? regionOf.get(id)! : -1);
      road[y].push(c === 'road');
      if (lot) { lx0 = Math.min(lx0, x); ly0 = Math.min(ly0, y); lx1 = Math.max(lx1, x + 1); ly1 = Math.max(ly1, y + 1); }
    }
  }

  // crossings: the world's with a cell the block owns, shifted to window coordinates
  const owner = ownerRaster(seed, r);
  const owns = (x: number, y: number) => owner[y]?.[x] === b.id;
  const crossings: Crossing[] = crossingsIn(seed, r).map(c => {
    const [ob, oa] = c.axis === 'h' ? [oy, ox] : [ox, oy];
    return { axis: c.axis, band0: c.band0 - ob, band1: c.band1 - ob, at: c.at - oa };
  }).filter(c => {
    for (let k = c.band0; k < c.band1; k++) for (let j = 0; j < CROSSING_LEN; j++) if (c.axis === 'h' ? owns(c.at + j, k) : owns(k, c.at + j)) return true;
    return false;
  });
  // road segments: the stretches of each corridor whose centre line the block owns
  const segs: Seg[] = [];
  for (const s of findSegs(cls, (_a, w) => ROAD_WIDTHS.includes(w))) {
    const k = s.band0 + Math.floor((s.band1 - s.band0) / 2), on = (p: number) => (s.axis === 'h' ? owns(p, k) : owns(k, p));
    for (let p = s.a; p < s.b; p++) {
      if (!on(p)) continue;
      let q = p;
      while (q < s.b && on(q)) q++;
      segs.push({ ...s, a: p, b: q });
      p = q;
    }
  }

  // topLimit (spec 4): per column, the centre line of the road band north of the column's northmost lot cell
  const top = Array.from({ length: cols }, (_, x) => {
    let y = 0;
    while (y < rows && !inP[y][x]) y++;
    if (y === rows) return 0;
    while (y >= 0 && !road[y][x]) y--;
    if (y < 0) return 0;
    const r1 = y + 1;
    while (y >= 0 && road[y][x]) y--;
    const r0 = y + 1;
    return r0 + Math.floor((r1 - r0) / 2);
  });

  const g = paintGround(seed, r);
  const layout: Layout = {
    cols, rows, cls, inP, bx0: lx0, by0: ly0, bx1: lx1, by1: ly1,
    rH: STREET_WIDTH, rV: STREET_WIDTH, sw: b.sw, sw2: WINDOW_SW2,
    roadDist: chebDist(road), shape: b.shape, region,
    regionStyle: others.map(id => blockById(seed, id).paving), mainStyle: b.paving,
    segs, crossings,
    base: g.base, over: g.over, mark: g.mark,
    topLimit: x => top[x] ?? 0, org: [ox, oy],
  };
  return { layout, ox, oy };
}

/** The window cell an object stands on: its ground footprint's centre, else the bottom-centre of its sprite. */
export function ownerCell(p: Placed): [number, number] {
  if (p.fp) return [Math.floor((p.fp.x0 + p.fp.x1) / 2 / TILE), Math.floor((p.fp.y0 + p.fp.y1) / 2 / TILE)];
  return [Math.floor((p.x + p.w / 2) / TILE), Math.floor((p.foot - 1) / TILE)];
}

/** The window cell a zone stands on: the centre of its rect. */
export function zoneCell(r: PxRect): [number, number] {
  return [Math.floor((r.x0 + r.x1) / 2 / TILE), Math.floor((r.y0 + r.y1) / 2 / TILE)];
}

/** Runs the generator on block b's window and keeps only the objects on cells b owns (spec 2.3); groups lose the
 *  dropped members, and groups left empty are removed. Zones are kept when b owns their centre cell, except the
 *  carriageways, which are cut to the stretches whose centre line b owns, so that the windows of all blocks along a
 *  road share it out without overlap; a zone's gid is dropped when its group is not kept (or is no group at all).
 *  Uncached; generateBlock is the cached entry point. */
export function generateInWindow(seed: string, b: BlockRec, win: BlockWindowLayout, opts: CityOptions = {}): BlockScene {
  const { layout, ox, oy } = win;
  // only the city options are passed on (a stray novelty from an untyped caller must not override CITY_NOVELTY)
  const city: CityOptions = {};
  if (opts.prune !== undefined) city.prune = opts.prune;
  if (opts.prefs !== undefined) city.prefs = opts.prefs;
  const scene = generateBase(`${seed}/${b.id}`, withDefaults({ novelty: CITY_NOVELTY, ...city, ...(b.district ? { district: b.district } : {}) }),
    { layout, params: { world: { seed, blockId: b.id, zone: b.zone, offset: [ox, oy] } },
      city: { zone: b.zone, gen: ZONES[b.zone].gen, ...(b.centre ? { centre: b.centre } : {}) } });
  const owner = ownerRaster(seed, { x0: ox, y0: oy, x1: ox + layout.cols, y1: oy + layout.rows });
  const owns = (x: number, y: number) =>
    (x >= 0 && y >= 0 && x < layout.cols && y < layout.rows ? owner[y][x] : ownerOf(seed, ox + x, oy + y)) === b.id;
  scene.objects = scene.objects.filter(p => owns(...ownerCell(p)));
  if (scene.groups) {
    const kept = new Set(scene.objects.map(o => o.id));
    scene.groups = scene.groups
      .map(g => ({ ...g, members: g.members.filter(m => kept.has(m)) }))
      .filter(g => g.members.length > 0);
  }
  if (scene.zones) {
    const groups = new Set((scene.groups ?? []).map(g => g.gid));
    const T = TILE, segOf = new Map(layout.segs.map(s => [JSON.stringify(s.axis === 'h'
      ? { x0: s.a * T, y0: s.band0 * T, x1: s.b * T, y1: s.band1 * T }
      : { x0: s.band0 * T, y0: s.a * T, x1: s.band1 * T, y1: s.b * T }), s]));
    const zones: ZoneRec[] = [];
    for (const z of scene.zones) {
      const s = z.kind === 'carriageway' ? segOf.get(JSON.stringify(z.rect)) : undefined;
      const parts: ZoneRec[] = [];
      if (s) {
        // runs of the centre line that b owns, each a zone across the full road width
        const k = s.band0 + Math.floor((s.band1 - s.band0) / 2);
        for (let p = s.a; p < s.b; p++) {
          if (!(s.axis === 'h' ? owns(p, k) : owns(k, p))) continue;
          let q = p;
          while (q < s.b && (s.axis === 'h' ? owns(q, k) : owns(k, q))) q++;
          const rect = s.axis === 'h' ? { ...z.rect, x0: p * T, x1: q * T } : { ...z.rect, y0: p * T, y1: q * T };
          parts.push({ ...z, id: parts.length ? `${z.id}#${parts.length}` : z.id, rect });
          p = q;
        }
      } else if (owns(...zoneCell(z.rect))) parts.push({ ...z });
      for (const m of parts) {
        if (m.gid !== undefined && !groups.has(m.gid)) delete m.gid;
        zones.push(m);
      }
    }
    scene.zones = zones;
  }
  return { scene, ox, oy };
}

// LRU of finished blocks; entries are never handed out, only clones of them, so callers cannot corrupt the cache
const cache = new Map<string, BlockScene>();

/** Clears the block-scene cache (tests use it to check results do not depend on the cache). */
export function _clearWindowCache(): void { cache.clear(); }

/** Block blockId of the world, generated in its window with ownership filtering; cached (BLOCK_CACHE entries). */
export function generateBlock(seed: string, blockId: string, opts: CityOptions = {}): BlockScene {
  const key = JSON.stringify([seed, blockId, opts.prune ?? null, opts.prefs ?? null]);
  let hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
  } else {
    const b = blockById(seed, blockId);
    hit = generateInWindow(seed, b, blockLayout(seed, b), opts);
    if (cache.size >= BLOCK_CACHE) cache.delete(cache.keys().next().value!);
    cache.set(key, hit);
  }
  return structuredClone(hit);
}
