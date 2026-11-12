// Chunk API (v0.8.1): the world cut into CHUNK x CHUNK cell chunks, each assembled from the blocks that own its
// cells. A chunk is a pure function of (seed, cx, cy, options), independent of cache state and request order.
import { arterialWhy, cellAt, hLine, vLine } from './arterials';
import { ZONE_NAME, blockById } from './blocks';
import { ownerOf, ownerRaster, worldCell } from './cells';
import { ARTERIAL_SPACING, CHUNK, STREET_WIDTH } from './config';
import { paintGround } from './ground';
import { blocksIn } from './region';
import { generateBlock, ownerCell, type CityOptions } from './window';
import { zoneAt, zoneValue } from './zone';
import { TILE, type Placed, type Scene, type TileRef } from '../gen/types';
import type { BlockScene } from './window';
import type { Rect, WorldCls, ZoneKind } from './types';

/** what a chunk needs of a block scene: window origin and size, ground layers, kept objects (window px) */
export interface CityBlock { id: string; ox: number; oy: number; cols: number; rows: number; ground: (TileRef | null)[][][]; objects: Placed[] }
export type ChunkObject = Placed & { blockId: string };   // world px; id = `${blockId}:${id}`, gid likewise
export interface Chunk {
  cx: number; cy: number;
  ground: (TileRef | null)[][][];   // layers x 64 x 64
  height: number[][];               // 64 x 64, all 0 in v0.8.1
  objects: ChunkObject[];           // objects whose ownerCell is in this chunk, sorted by (foot, sub)
  blocks: string[];                 // blocksIn(seed, chunk rect)
  missing?: string[];               // blocks that were not available (failed); their cells use paintGround
}

export function chunkRect(cx: number, cy: number): Rect {
  return { x0: cx * CHUNK, y0: cy * CHUNK, x1: (cx + 1) * CHUNK, y1: (cy + 1) * CHUNK };
}

/** world cell -> chunk (floor, so negative cells land in negative chunks) */
export function chunkOf(x: number, y: number): [number, number] {
  return [Math.floor(x / CHUNK), Math.floor(y / CHUNK)];
}

/** The fields of a block scene a chunk uses; no trace, audit, zones or groups. */
export function trimBlock(id: string, b: BlockScene): CityBlock {
  const s = b.scene;
  return { id, ox: b.ox, oy: b.oy, cols: s.cols, rows: s.rows, ground: s.ground, objects: s.objects };
}

export function assembleChunk(seed: string, cx: number, cy: number, block: (id: string) => CityBlock | undefined): Chunk {
  const r = chunkRect(cx, cy);
  const ids = blocksIn(seed, r);
  const owner = ownerRaster(seed, r);
  const got = new Map<string, CityBlock>(), missing: string[] = [];
  for (const id of ids) {
    const b = block(id);
    if (b) got.set(id, b); else missing.push(id);
  }
  let layers = 2;
  for (const b of got.values()) layers = Math.max(layers, b.ground.length);
  const ground: (TileRef | null)[][][] = Array.from({ length: layers }, () =>
    Array.from({ length: CHUNK }, () => Array<TileRef | null>(CHUNK).fill(null)));
  const world = missing.length ? paintGround(seed, r) : undefined;
  const gone = new Set(missing);
  for (let y = 0; y < CHUNK; y++) for (let x = 0; x < CHUNK; x++) {
    const id = owner[y][x], b = got.get(id);
    if (b) {
      const wx = x + r.x0 - b.ox, wy = y + r.y0 - b.oy;
      for (let l = 0; l < layers; l++) ground[l][y][x] = b.ground[l]?.[wy]?.[wx] ?? null;
    } else if (world && gone.has(id)) {
      ground[0][y][x] = world.base[y][x];
      ground[1][y][x] = world.over[y][x];
    }
  }

  const objects: ChunkObject[] = [];
  for (const [id, b] of got) {
    const dx = b.ox * TILE, dy = b.oy * TILE;
    for (const o of b.objects) {
      const [x, y] = ownerCell(o);
      const wx = x + b.ox, wy = y + b.oy;
      if (wx < r.x0 || wy < r.y0 || wx >= r.x1 || wy >= r.y1) continue;
      const m: ChunkObject = { ...o, blockId: id, id: `${id}:${o.id}`, x: o.x + dx, y: o.y + dy, foot: o.foot + dy };
      if (o.gid) m.gid = `${id}:${o.gid}`;
      if (o.solid !== undefined) m.solid = o.solid + dy;
      if (o.fp) m.fp = { x0: o.fp.x0 + dx, y0: o.fp.y0 + dy, x1: o.fp.x1 + dx, y1: o.fp.y1 + dy };
      if (o.anchor) m.anchor = { ...o.anchor, x: o.anchor.x + dx, y: o.anchor.y + dy };
      objects.push(m);
    }
  }
  objects.sort((a, b) => a.foot - b.foot || (a.sub ?? 0) - (b.sub ?? 0));

  const c: Chunk = { cx, cy, ground, height: Array.from({ length: CHUNK }, () => Array<number>(CHUNK).fill(0)), objects, blocks: ids };
  if (missing.length) c.missing = missing;
  return c;
}

export function getChunk(seed: string, cx: number, cy: number, opts: CityOptions = {}): Chunk {
  return assembleChunk(seed, cx, cy, id => trimBlock(id, generateBlock(seed, id, opts)));
}

export function getBlock(seed: string, blockId: string, opts: CityOptions = {}): Scene {
  return generateBlock(seed, blockId, opts).scene;
}

export interface WorldInfo { cls: WorldCls; blockId?: string; owner: string; zone: ZoneKind; z: number; level: number; why: string[] }

/** Arterial lines through (x, y): vertical line i on the segment j covering y (x inside its band), horizontal alike. */
function arterialsAt(seed: string, x: number, y: number): string[] {
  const out: string[] = [];
  const i0 = Math.floor(x / ARTERIAL_SPACING.x), j0 = Math.floor(y / ARTERIAL_SPACING.y);
  for (let i = i0 - 2; i <= i0 + 2; i++) for (let j = j0 - 2; j <= j0 + 2; j++) {
    // segment j of vertical line i lies between the horizontal lines j and j + 1 (either neighbouring cell column)
    // loose y range of the segment: from the upper edge of horizontal line j to the lower edge of line j + 1 in either
    // neighbouring cell column (jogs move the two columns apart; the x band test below keeps this exact enough)
    const [t0, t1, b0, b1] = [hLine(seed, j, i - 1), hLine(seed, j, i), hLine(seed, j + 1, i - 1), hLine(seed, j + 1, i)];
    const ya = Math.min(t0.y0, t1.y0), yb = Math.max(b0.y0 + b0.h, b1.y0 + b1.h);
    const v = vLine(seed, i, j);
    if (y >= ya && y < yb && x >= v.x0 && x < v.x0 + v.w) out.push(arterialWhy(seed, 'v', i));
  }
  for (let j = j0 - 2; j <= j0 + 2; j++) for (let i = i0 - 2; i <= i0 + 2; i++) {
    const [l0, l1, r0, r1] = [vLine(seed, i, j - 1), vLine(seed, i, j), vLine(seed, i + 1, j - 1), vLine(seed, i + 1, j)];
    const xa = Math.min(l0.x0, l1.x0), xb = Math.max(r0.x0 + r0.w, r1.x0 + r1.w);
    const h = hLine(seed, j, i);
    if (x >= xa && x < xb && y >= h.y0 && y < h.y0 + h.h) out.push(arterialWhy(seed, 'h', j));
  }
  return [...new Set(out)];
}

export function worldInfo(seed: string, x: number, y: number): WorldInfo {
  const wc = worldCell(seed, x, y), owner = ownerOf(seed, x, y);
  const zone = zoneAt(seed, x, y), z = zoneValue(seed, x, y);
  const why = [`分区：${ZONE_NAME[zone]}（z = ${z.toFixed(2)}）`];
  if (wc.block) {
    const b = blockById(seed, wc.block);
    why.push(...b.why, `街区 ${b.id}：${b.shape}，人行道 ${b.sw} 格，铺地 ${b.paving}`);
  } else if (wc.arterial) {
    why.push(...arterialsAt(seed, x, y));
  } else {
    const ij = cellAt(seed, x, y)!;
    why.push(`支路：主干道格 (${ij[0]},${ij[1]}) 里切出来的马路，宽 ${STREET_WIDTH} 格`);
  }
  if (!wc.block) why.push(`这一格归 ${owner}（最近的人行道，spec 2.3）`);
  const info: WorldInfo = { cls: wc.cls, owner, zone, z, level: 0, why };
  if (wc.block) info.blockId = wc.block;
  return info;
}
