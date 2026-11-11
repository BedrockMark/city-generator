// Block windows (spec 4): one world block plus its surroundings as a gen Layout, the single-block generator run on it,
// and the ownership filter (spec 2.3) that keeps only the objects standing on cells the block owns.
import { blockById } from './blocks';
import { classRaster, blockRaster, crossingsIn, ownerOf } from './cells';
import { paintGround } from './ground';
import { BLOCK_CACHE, CITY_NOVELTY, ROAD_WIDTHS, STREET_WIDTH, WINDOW_MARGIN, WINDOW_SW2 } from './config';
import { chebDist, findSegs, type Crossing, type Layout } from '../gen/layout';
import { generateBase } from '../gen/generate';
import { withDefaults } from '../gen/exp';
import { TILE, type CellClass, type Placed, type Scene } from '../gen/types';
import type { BlockRec, Rect } from './types';

/** city mode options; no novelty (spec 3.9: CITY_NOVELTY is fixed) */
export interface CityOptions { prune?: boolean; prefs?: boolean }
/** scene in window coordinates; (ox, oy) = the window's top-left world cell */
export interface BlockScene { scene: Scene; ox: number; oy: number }
export interface BlockWindowLayout { layout: Layout; ox: number; oy: number }

/** The window of block b: its footprint's bounding box grown by `margin`, as a Layout in window coordinates. */
export function blockLayout(seed: string, b: BlockRec, margin = WINDOW_MARGIN): BlockWindowLayout {
  const bx0 = Math.min(...b.foot.map(f => f.x0)), by0 = Math.min(...b.foot.map(f => f.y0));
  const bx1 = Math.max(...b.foot.map(f => f.x1)), by1 = Math.max(...b.foot.map(f => f.y1));
  const r: Rect = { x0: bx0 - margin, y0: by0 - margin, x1: bx1 + margin, y1: by1 + margin };
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

  // crossings: the world's, clipped to the window and shifted to window coordinates
  const crossings: Crossing[] = crossingsIn(seed, r).map(c => {
    const [ob, oa] = c.axis === 'h' ? [oy, ox] : [ox, oy];
    return { axis: c.axis, band0: c.band0 - ob, band1: c.band1 - ob, at: c.at - oa };
  });

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
    segs: findSegs(cls, (_a, w) => ROAD_WIDTHS.includes(w)), crossings,
    base: g.base, over: g.over, mark: g.mark,
    topLimit: x => top[x] ?? 0,
  };
  return { layout, ox, oy };
}

/** The window cell an object stands on: its ground footprint's centre, else the bottom-centre of its sprite. */
export function ownerCell(p: Placed): [number, number] {
  if (p.fp) return [Math.floor((p.fp.x0 + p.fp.x1) / 2 / TILE), Math.floor((p.fp.y0 + p.fp.y1) / 2 / TILE)];
  return [Math.floor((p.x + p.w / 2) / TILE), Math.floor((p.foot - 1) / TILE)];
}

/** Runs the generator on block b's window and keeps only the objects on cells b owns (spec 2.3); groups lose the
 *  dropped members, and groups left empty are removed. Uncached; generateBlock is the cached entry point. */
export function generateInWindow(seed: string, b: BlockRec, win: BlockWindowLayout, opts: CityOptions = {}): BlockScene {
  const { layout, ox, oy } = win;
  // only the city options are passed on (a stray novelty from an untyped caller must not override CITY_NOVELTY)
  const city: CityOptions = {};
  if (opts.prune !== undefined) city.prune = opts.prune;
  if (opts.prefs !== undefined) city.prefs = opts.prefs;
  const scene = generateBase(`${seed}/${b.id}`, withDefaults({ novelty: CITY_NOVELTY, ...city }),
    { layout, params: { world: { seed, blockId: b.id, zone: b.zone, offset: [ox, oy] } } });
  const owner = new Map<string, string>();       // ownerOf is slow: once per cell
  const owns = (p: Placed) => {
    const [cx, cy] = ownerCell(p);
    const k = `${cx},${cy}`;
    let o = owner.get(k);
    if (o === undefined) { o = ownerOf(seed, ox + cx, oy + cy); owner.set(k, o); }
    return o === b.id;
  };
  scene.objects = scene.objects.filter(owns);
  if (scene.groups) {
    const kept = new Set(scene.objects.map(o => o.id));
    scene.groups = scene.groups
      .map(g => ({ ...g, members: g.members.filter(m => kept.has(m)) }))
      .filter(g => g.members.length > 0);
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
