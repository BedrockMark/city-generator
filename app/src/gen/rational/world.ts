// Stage 5: a neutral view of a finished map for the constraint checker. Built either from a generated scene
// or from an analysed reference (tools/export_refworld.py), so the same constraints can be measured on both.
// Read-only: nothing here feeds back into generation.
import { spr } from '../assets';
import { TILE as T, type Anchor, type PxRect, type Scene, type ZoneRec, type TileRef } from '../types';

export const isGrassTile = (t: TileRef | null | undefined) => !!t && t[0] === 'terr' && t[1] <= 2 && t[2] >= 11 && t[2] <= 13;

export type Ground = 'road' | 'walk' | 'lot' | 'wall' | 'water' | 'none';

export interface WObj {
  /** index in the source object list */
  i: number;
  id: string; key: string; cls: string;
  person: boolean; sit: boolean;
  /** foot point (bottom-centre of the opaque box) */
  fx: number; fy: number;
  /** ground footprint; null for things that do not occupy ground */
  fp: PxRect | null;
  /** opaque box */
  bb: PxRect;
  gid?: string; group?: string; anchor?: Anchor;
  /** the placement's reason (generated scenes) */
  reason?: string;
  /** reference objects: detection confidence */
  conf?: string;
}

export interface WDoor { bid: string; x: number; y: number; block: string }

export interface World {
  src: 'gen' | 'ref'; name: string;
  W: number; H: number;
  ground(px: number, py: number): Ground;
  /** lawn on the ground (grass overlay) */
  lawn(px: number, py: number): boolean;
  /** base ground tile (generated scenes), for continuing a path in the same paving */
  baseTile?(cx: number, cy: number): TileRef | null;
  /** building footprints (solid); the upper floors take no ground (D38) */
  walls: PxRect[];
  objs: WObj[];
  doors: WDoor[];
  zones: ZoneRec[];
}

export const inRect = (r: PxRect, x: number, y: number) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;
export const rectsOverlap = (a: PxRect, b: PxRect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
/** gap between two rects (0 when they touch or overlap) */
export function rectGap(a: PxRect, b: PxRect): number {
  const dx = Math.max(0, b.x0 - a.x1, a.x0 - b.x1), dy = Math.max(0, b.y0 - a.y1, a.y0 - b.y1);
  return Math.hypot(dx, dy);
}
export const grow = (r: PxRect, d: number): PxRect => ({ x0: r.x0 - d, y0: r.y0 - d, x1: r.x1 + d, y1: r.y1 + d });

/** frame row 4 of the character sheet is the sitting pose (people.ts frameFor) */
const isSit = (frame?: [number, number]) => frame?.[1] === 4;

export function worldFromScene(sc: Scene): World {
  const W = sc.cols * T, H = sc.rows * T;
  const walls = (sc.buildings ?? []).map(b => b.solid);
  // the carriageway is not for pedestrians, but driveways and zebras are
  const crossable = (sc.zones ?? []).filter(z => z.kind === 'driveway' || z.kind === 'zebra').map(z => z.rect);
  const ground = (px: number, py: number): Ground => {
    const c = sc.cells[Math.floor(py / T)]?.[Math.floor(px / T)];
    if (c === undefined) return 'none';
    if (c === 'road') return crossable.some(r => inRect(r, px, py)) ? 'lot' : 'road';
    return c === 'walk' || c === 'nwalk' ? 'walk' : 'lot';
  };
  const objs: WObj[] = [];
  sc.objects.forEach((o, i) => {
    if (o.cls === 'building') return;
    let bb: PxRect;
    if (o.kind === 'sprite') { const s = spr(o.key); bb = { x0: o.x + s.bb[0], y0: o.y + s.bb[1], x1: o.x + s.bb[2], y1: o.y + s.bb[3] }; }
    else bb = { x0: o.x + 3, y0: o.y + 8, x1: o.x + 13, y1: o.y + 32 };
    const fx = (bb.x0 + bb.x1) / 2, fy = o.kind === 'char' ? o.foot : bb.y1;
    objs.push({ i, id: o.id ?? `o${i}`, key: o.key, cls: o.kind === 'char' ? 'person' : o.cls, person: o.kind === 'char', sit: o.kind === 'char' && isSit(o.frame),
      fx, fy, fp: o.fp ?? null, bb, gid: o.gid, group: o.group, anchor: o.anchor, reason: o.reason });
  });
  const doors: WDoor[] = [];
  for (const b of sc.buildings ?? []) for (const d of b.doors) doors.push({ bid: b.id, x: d.x, y: d.y, block: b.block });
  const lawn = (px: number, py: number) => isGrassTile(sc.ground[1]?.[Math.floor(py / T)]?.[Math.floor(px / T)]);
  const baseTile = (cx: number, cy: number) => sc.ground[0]?.[cy]?.[cx] ?? null;
  return { src: 'gen', name: `seed${sc.seed}`, W, H, ground, lawn, baseTile, walls, objs, doors, zones: sc.zones ?? [] };
}

/** analysed reference (work/refworld/<name>.json) */
export interface RefWorldJSON {
  name: string; size: [number, number]; phase: [number, number]; origin: [number, number];
  ground: string[][];
  objects: { key: string; cls: string; conf: string; x: number; y: number; w: number; h: number; bb: [number, number, number, number] }[];
}

const FOOT_DEPTH: Record<string, number> = { vehicle: 22 };

export function worldFromRef(j: RefWorldJSON): World {
  const [W, H] = j.size, [ox, oy] = j.phase, [cx0, cy0] = j.origin;
  const g = (px: number, py: number) => j.ground[Math.floor((py - oy) / T) - cy0]?.[Math.floor((px - ox) / T) - cx0];
  const ground = (px: number, py: number): Ground => {
    if (px < 0 || py < 0 || px >= W || py >= H) return 'none';
    const c = g(px, py);
    if (c === 'road') return 'road';
    if (c === 'paved') return 'walk';
    if (c === 'building') return 'wall';
    if (c === 'water') return 'water';
    if (c === undefined || c === '') return 'none';
    return 'lot';   // grass, sand, dirt, other
  };
  // walls: building-class cells (whole building sprites: references carry no footprint split)
  const walls: PxRect[] = [];
  j.ground.forEach((row, r) => row.forEach((c, cc) => {
    if (c === 'building') { const x = ox + (cc + cx0) * T, y = oy + (r + cy0) * T; walls.push({ x0: x, y0: y, x1: x + T, y1: y + T }); }
  }));
  const objs: WObj[] = [];
  j.objects.forEach((o, i) => {
    if (o.cls === 'building') return;
    const bb = { x0: o.bb[0], y0: o.bb[1], x1: o.bb[2], y1: o.bb[3] };
    const d = Math.min(FOOT_DEPTH[o.cls] ?? 10, bb.y1 - bb.y0);
    const flat = o.cls === 'manhole' || /Ground_Tile|Crack|Brake_Marks|Puddle|Stain/.test(o.key);
    objs.push({ i, id: `r${i}`, key: o.key, cls: o.cls, person: false, sit: false, fx: (bb.x0 + bb.x1) / 2, fy: bb.y1,
      fp: flat ? null : { x0: bb.x0, y0: bb.y1 - d, x1: bb.x1, y1: bb.y1 }, bb, conf: o.conf });
  });
  const lawn = (px: number, py: number) => g(px, py) === 'grass';
  return { src: 'ref', name: j.name, W, H, ground, lawn, walls, objs, doors: [], zones: [] };
}
