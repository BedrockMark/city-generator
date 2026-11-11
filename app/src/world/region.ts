// A rectangle of the world as one Scene (spec 5): the world ground, overlaid on every cell with the ground of the
// block that owns it, plus the kept objects / buildings / groups / zones of every block that owns a cell of the rect,
// moved to region pixel coordinates (zones follow the objects' rule: their centre cell). Pure function of
// (seed, rect, options): the blocks come from the cached generateBlock, whose results do not depend on the cache.
import { cellRect } from './arterials';
import { cellBlocks } from './blocks';
import { cellRange, classRaster, ownerRaster } from './cells';
import { paintGround } from './ground';
import { generateBlock, ownerCell, zoneCell, type CityOptions } from './window';
import { CITY_NOVELTY, REGION_PAD } from './config';
import { VERSION } from '../gen/generate';
import { withDefaults } from '../gen/exp';
import { SHEETS, TILE, type Anchor, type BuildingRec, type GroupRec, type Placed, type PxRect, type Scene, type TileRef, type ZoneRec } from '../gen/types';
import type { Rect } from './types';

const hits = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** Ids (sorted) of the blocks whose footprint, grown by REGION_PAD (how far a road cell can be from its owner's
 *  sidewalk), intersects r: every block that can own a cell of r. Includes blocks that only own road cells of r. */
export function blocksIn(seed: string, r: Rect): string[] {
  const P = REGION_PAD, pr: Rect = { x0: r.x0 - P, y0: r.y0 - P, x1: r.x1 + P, y1: r.y1 + P };
  const { i0, i1, j0, j1 } = cellRange(pr);
  const out: string[] = [];
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    if (!hits(cellRect(seed, i, j), pr)) continue;
    for (const b of cellBlocks(seed, i, j)) if (b.foot.some(f => hits(f, pr))) out.push(b.id);
  }
  return out.sort();
}

const movePx = (p: PxRect, dx: number, dy: number): PxRect => ({ x0: p.x0 + dx, y0: p.y0 + dy, x1: p.x1 + dx, y1: p.y1 + dy });
const moveAnchor = (a: Anchor | undefined, dx: number, dy: number) => (a ? { ...a, x: a.x + dx, y: a.y + dy } : undefined);

/** The world rect r as one scene (spec 5); see the file comment. Ids and group ids are prefixed with `<blockId>:`. */
export function assembleRegion(seed: string, r: Rect, opts: CityOptions = {}): Scene {
  const cols = r.x1 - r.x0, rows = r.y1 - r.y0;
  const g = paintGround(seed, r);
  const ground: (TileRef | null)[][][] = [g.base.map(row => [...row]), g.over.map(row => [...row])];
  const owner = ownerRaster(seed, r);
  const blocks = blocksIn(seed, r);
  const objects: Placed[] = [], groups: GroupRec[] = [], buildings: BuildingRec[] = [], zones: ZoneRec[] = [];
  const pre = (id: string, s: string) => `${id}:${s}`;

  for (const id of blocks) {
    const { scene, ox, oy } = generateBlock(seed, id, opts);
    const cx = ox - r.x0, cy = oy - r.y0;          // window origin in region cells
    const dx = cx * TILE, dy = cy * TILE;            // and in region px

    // ground: the block's own layers on the cells it owns (driveways, yards ... repainted by the generator)
    scene.ground.forEach((layer, li) => {
      while (ground.length <= li) ground.push(Array.from({ length: rows }, () => Array<TileRef | null>(cols).fill(null)));
      for (let y = Math.max(0, -cy); y < Math.min(scene.rows, rows - cy); y++)
        for (let x = Math.max(0, -cx); x < Math.min(scene.cols, cols - cx); x++)
          if (owner[y + cy][x + cx] === id) ground[li][y + cy][x + cx] = layer[y][x];
    });

    // objects standing on a cell of r (generateBlock already kept only those on cells the block owns)
    const kept = new Set<string>(), keptG = new Set<string>();
    for (const o of scene.objects) {
      const [x, y] = ownerCell(o);
      if (x + cx < 0 || y + cy < 0 || x + cx >= cols || y + cy >= rows) continue;
      kept.add(o.id!);
      if (o.gid) keptG.add(o.gid);
      const m: Placed = { ...o, id: pre(id, o.id!), x: o.x + dx, y: o.y + dy, foot: o.foot + dy };
      if (o.gid) m.gid = pre(id, o.gid);
      if (o.solid !== undefined) m.solid = o.solid + dy;
      if (o.fp) m.fp = movePx(o.fp, dx, dy);
      if (o.anchor) m.anchor = moveAnchor(o.anchor, dx, dy);
      objects.push(m);
    }
    const keptGroups = new Set<string>();
    for (const gr of scene.groups ?? []) {
      const members = gr.members.filter(mm => kept.has(mm));
      if (!members.length) continue;
      keptGroups.add(gr.gid);
      const m: GroupRec = { ...gr, gid: pre(id, gr.gid), members: members.map(mm => pre(id, mm)) };
      if (gr.anchor) m.anchor = moveAnchor(gr.anchor, dx, dy);
      if (gr.bbox) m.bbox = movePx(gr.bbox, dx, dy);
      groups.push(m);
    }
    // buildings whose sprites were kept
    for (const b of scene.buildings ?? []) {
      if (!keptG.has(b.gid)) continue;
      buildings.push({ ...b, gid: pre(id, b.gid), id: pre(id, b.id), rect: movePx(b.rect, dx, dy), solid: movePx(b.solid, dx, dy),
        doors: b.doors.map(d => ({ x: d.x + dx, y: d.y + dy })) });
    }
    // zones by the objects' rule: kept when their centre cell is a cell of r the block owns (generateBlock already
    // kept only zones centred on its own cells); a group id is kept only if that group is
    for (const z of scene.zones ?? []) {
      const rect = movePx(z.rect, dx, dy);
      const [x, y] = zoneCell(rect);
      if (x < 0 || y < 0 || x >= cols || y >= rows || owner[y][x] !== id) continue;
      const m: ZoneRec = { ...z, id: pre(id, z.id), rect };
      if (z.gid && keptGroups.has(z.gid)) m.gid = pre(id, z.gid); else delete m.gid;
      zones.push(m);
    }
  }

  return {
    version: VERSION, seed,
    params: { world: { seed, rect: { ...r }, blocks } },
    cols, rows, tile: TILE, sheets: SHEETS,
    ground, objects, cells: classRaster(seed, r), notes: [],
    // the options every block ran with (as in generateInWindow: only the city options, novelty fixed)
    options: withDefaults({
      novelty: CITY_NOVELTY,
      ...(opts.prune !== undefined ? { prune: opts.prune } : {}),
      ...(opts.prefs !== undefined ? { prefs: opts.prefs } : {}),
    }),
    groups, buildings, zones,
  };
}
