// Stage 6 judge: put a generated scene and an analysed reference on the same footing (docs/superpowers/specs/
// 2026-11-03-stage6-judge-design.md 2.2). The judge must only see what the reference analysis can see, otherwise it
// learns "how the two were measured" instead of "what looks odd":
// - ground: references class every cell by the colour of its base tile (tools/semantics.py ground_class), so the
//   generated ground is classed by the same rule (data/tileclass.json), not by its semantic cell class;
// - walls: references mark every cell of a building sprite (tw x th) as building, so do we (upper floors included);
// - objects: the 17 classes of semantics.py (data/semclass.json); no people, no buildings, nothing hidden behind a
//   building (the reference detector cannot see it); references keep only conf = high detections;
// - doors, zones, reasons and gids are generator-only and are dropped.
import { spr, hasSprite } from '../assets';
import { SHEET_COLS, TILE as T, type Placed, type PxRect, type Scene, type TileRef } from '../types';
import type { RefWorldJSON } from '../rational/world';
import tileclassRaw from '../data/tileclass.json';
import semclassRaw from '../data/semclass.json';

export type JGround = 'road' | 'paved' | 'grass' | 'wall' | 'other' | 'none';
export interface JObj { key: string; cls: string; bb: PxRect; fx: number; fy: number; stream?: string; id?: string }
/** cells (r, c) cover px [ox + c * 16, +16) x [oy + r * 16, +16) */
export interface JWorld { name: string; src: 'gen' | 'ref'; cols: number; rows: number; ox: number; oy: number; ground: JGround[][]; objs: JObj[] }

const TILECLASS = tileclassRaw as unknown as Record<string, [string, number][]>;
const SEMCLASS = semclassRaw as Record<string, string>;

/** colour class -> judge ground */
const fromColour = (c: string | undefined): JGround => c === 'road' || c === 'paved' || c === 'grass' ? c : c ? 'other' : 'none';
const tileInfo = (t: TileRef | null | undefined): [string, number] | undefined => t ? TILECLASS[t[0]]?.[t[2] * SHEET_COLS[t[0]] + t[1]] : undefined;

export function objBox(o: Placed): PxRect {
  if (o.kind === 'sprite' && hasSprite(o.key)) { const b = spr(o.key).bb; return { x0: o.x + b[0], y0: o.y + b[1], x1: o.x + b[2], y1: o.y + b[3] }; }
  if (o.kind === 'char') return { x0: o.x + 3, y0: o.y + 8, x1: o.x + 13, y1: o.y + 32 };
  return { x0: o.x, y0: o.y, x1: o.x + o.w, y1: o.y + o.h };
}

/** objects standing behind a building, inside its sprite (drawn over by it) */
export function hiddenObjects(sc: Scene): Set<string> {
  const out = new Set<string>();
  for (const o of sc.objects) {
    if (o.cls === 'building') continue;
    const b = objBox(o);
    if ((sc.buildings ?? []).some(bd => o.foot < bd.solid.y0 && b.x0 >= bd.rect.x0 && b.x1 <= bd.rect.x1 && b.y0 >= bd.rect.y0)) out.add(o.id!);
  }
  return out;
}

export function alignScene(sc: Scene): JWorld {
  const ground: JGround[][] = [];
  for (let y = 0; y < sc.rows; y++) {
    const row: JGround[] = [];
    for (let x = 0; x < sc.cols; x++) {
      const over = tileInfo(sc.ground[1]?.[y]?.[x]), base = tileInfo(sc.ground[0]?.[y]?.[x]);
      row.push(fromColour(over && over[1] >= 0.99 ? over[0] : base?.[0]));
    }
    ground.push(row);
  }
  for (const o of sc.objects) {
    if (o.cls !== 'building') continue;
    for (let y = Math.max(0, Math.floor(o.y / T)); y < Math.min(sc.rows, Math.ceil((o.y + o.h) / T)); y++)
      for (let x = Math.max(0, Math.floor(o.x / T)); x < Math.min(sc.cols, Math.ceil((o.x + o.w) / T)); x++) ground[y][x] = 'wall';
  }
  const hidden = hiddenObjects(sc);
  const objs: JObj[] = [];
  sc.objects.forEach((o, i) => {
    if (o.cls === 'building' || o.kind === 'char' || hidden.has(o.id ?? `o${i}`)) return;
    const bb = objBox(o);
    objs.push({ key: o.key, cls: SEMCLASS[o.key] ?? 'other', bb, fx: (bb.x0 + bb.x1) / 2, fy: bb.y1, stream: o.stream, id: o.id ?? `o${i}` });
  });
  return { name: `seed${sc.seed}`, src: 'gen', cols: sc.cols, rows: sc.rows, ox: 0, oy: 0, ground, objs };
}

export function alignRef(j: RefWorldJSON): JWorld {
  const ground = j.ground.map(row => row.map(c => c === 'building' ? 'wall' : fromColour(c)));
  const objs: JObj[] = j.objects.filter(o => o.conf === 'high' && o.cls !== 'building').map((o, i) => {
    const bb = { x0: o.bb[0], y0: o.bb[1], x1: o.bb[2], y1: o.bb[3] };
    return { key: o.key, cls: o.cls, bb, fx: (bb.x0 + bb.x1) / 2, fy: bb.y1, id: `r${i}` };
  });
  return { name: j.name, src: 'ref', cols: j.ground[0]?.length ?? 0, rows: j.ground.length, ox: j.phase[0] + j.origin[0] * T, oy: j.phase[1] + j.origin[1] * T, ground, objs };
}
