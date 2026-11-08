// Building factory: modular floor stacks (5_Floor_Modular) and complete single-sprite buildings.
import { Rng } from './rng';
import { MODULAR, spr, hasSprite, type ModPiece } from './assets';
import { TILE } from './types';

export type FrontKind = 'cafe' | 'bakery' | 'retail' | 'closed' | 'gym' | 'condo' | 'market' | 'house' | 'hardware' | 'office' | 'hotel' | 'landmark';

export interface BuildingPlan {
  id: string;
  w: number; h: number;                    // cells (full sprite rect)
  /** footprint depth in cells (bottom rows of the sprite rect); the rows above are ground hidden behind the building */
  foot: number;
  parts: { key: string; dx: number; dy: number; sub: number; role: 'roof' | 'mid' | 'ground' | 'whole' | 'link' }[];   // px offsets from top-left
  doors: number[];                         // door centre x offsets (px) on the bottom edge
  front: FrontKind;
  tall: boolean;
  label: string;
  /** experiment that produced it (exp-05 kit buildings) */
  exp?: string;
}

const pieces = (fam: string, colour?: string, pred?: (p: ModPiece) => boolean) =>
  (MODULAR[fam] ?? []).filter(p => (!colour || p.colour === colour || p.colour === 'any') && (!pred || pred(p)));

const GF_FAMILIES: { fam: string; front: FrontKind; door: number; w: number }[] = [
  { fam: 'Ground_Floor_Shop', front: 'retail', door: 5.5, w: 6 },
  { fam: 'Ground_Floor_Bakery', front: 'bakery', door: 5.5, w: 2 },
  { fam: 'Ground_Floor_Butchery', front: 'retail', door: 3.5, w: 1 },
  { fam: 'Ground_Floor_Ice_Cream_Shop', front: 'cafe', door: 3.5, w: 2 },
  { fam: 'Ground_Floor_Music_Store', front: 'retail', door: 5.5, w: 1 },
  { fam: 'Ground_Floor_Gym', front: 'gym', door: 5.5, w: 1 },
  { fam: 'Ground_Floor_Condo', front: 'condo', door: 3.5, w: 4 },
];

let nextId = 0;

/** roof + n middle floors + ground floor, one colourway; ground-floor sign may overhang the floor above */
export function modularStack(r: Rng, opts: { floors?: number; front?: FrontKind; colour?: 'red' | 'blue' | 'grey'; avoidFamily?: string; roof?: string; id?: string } = {}): BuildingPlan {
  const colour = opts.colour ?? r.choose('bld.colour', {}, ['red', 'blue', 'grey'] as const);
  const famPool = GF_FAMILIES.filter(f => (!opts.front || f.front === opts.front || (opts.front === 'closed' && f.front === 'retail')) && !(opts.avoidFamily && f.fam.endsWith(opts.avoidFamily)));
  const fam = r.choose('bld.groundFloor', { front: opts.front ?? 'any' }, { weights: (famPool.length ? famPool : GF_FAMILIES).map(f => [f, f.w] as const) });
  const gfAll = pieces(fam.fam, colour);
  // odd variants are open storefronts, even ones shuttered (verified on the contact sheets)
  const wantClosed = opts.front === 'closed' || (fam.front !== 'condo' && r.choose('bld.shuttered', { fam: fam.fam }, { p: 0.15 }));
  const gfPool = gfAll.filter(p => fam.front === 'condo' || ((p.v % 2 === 0) === wantClosed));
  const gf = r.choose('bld.groundFloorVariant', { fam: fam.fam }, gfPool.length ? gfPool : gfAll);
  const floors = opts.floors ?? r.choose('bld.floors', {}, { weights: [[0, 2], [1, 4], [2, 3], [3, 1]] as const });
  const mids = Array.from({ length: floors }, () => r.choose('bld.middleFloor', { colour }, pieces('Middle_Floor', colour)));
  // repeat the same middle floor most of the time (as in the refs), sometimes mix
  if (floors > 1 && r.choose('bld.sameMiddle', { floors }, { p: 0.6 })) mids.fill(mids[0]);
  // a given roof (the next section of a terrace keeps the roof so it can merge) takes no draw
  const roof = opts.roof ? pieces('Roof').find(p => p.key === opts.roof)! : r.choose('bld.roof', {}, pieces('Roof'));
  const roofH = spr(roof.key).h / TILE;
  const parts: BuildingPlan['parts'] = [];
  let y = 0, sub = 0;
  parts.push({ key: roof.key, dx: 0, dy: y, sub: sub++, role: 'roof' }); y += roofH * TILE;
  for (const m of mids) { parts.push({ key: m.key, dx: 0, dy: y, sub: sub++, role: 'mid' }); y += 4 * TILE; }
  const gfS = spr(gf.key);
  parts.push({ key: gf.key, dx: 0, dy: y - (gfS.h - 3 * TILE), sub: sub++, role: 'ground' });
  y += 3 * TILE;
  const front: FrontKind = fam.front === 'condo' ? 'condo' : wantClosed ? 'closed' : fam.front;
  // footprint = roof size: in this 3/4 view the roof is the building's plan
  // condo ground floors: odd variants have the door at 5 cells, even ones at 3.5 (measured; user label 684358 L2)
  const door = fam.front === 'condo' && gf.v % 2 === 1 ? 5 : fam.door;
  return { id: opts.id ?? `b${nextId++}`, w: 7, h: y / TILE, foot: Math.min(roofH, y / TILE), parts, doors: [door * TILE], front, tall: floors >= 2,
    label: `${fam.fam.replace('Ground_Floor_', '')}/${colour}/${floors}f` };
}

/** complete single-sprite buildings usable in a mixed commercial/residential block */
const SINGLES: { key: string; front: FrontKind; doors: number[]; weight: number }[] = [
  ...[1, 2, 3].map(i => ({ key: `4_Generic_Building/Condo_5_${i}`, front: 'condo' as const, doors: [3], weight: 2 })),
  { key: '4_Generic_Building/Condo_3_45', front: 'condo', doors: [2.5], weight: 2 },
  { key: '4_Generic_Building/Condo_9_Example', front: 'condo', doors: [3], weight: 1.5 },
  { key: '4_Generic_Building/Condo_Example', front: 'condo', doors: [2.5], weight: 1 },
  { key: '4_Generic_Building/Condo_4_38', front: 'condo', doors: [3, 12.5], weight: 1 },
  { key: '4_Generic_Building/Condo_4_39', front: 'condo', doors: [3, 12.5], weight: 1 },
  { key: '4_Generic_Building/Condo_6', front: 'condo', doors: [4], weight: 1 },
  { key: '4_Generic_Building/Hardware_Store_Example', front: 'hardware', doors: [4], weight: 1 },
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(i => ({ key: `9_Shopping_Center_and_Markets/Market_Medium_${i}`, front: 'market' as const, doors: [3.5], weight: 0.35 })),
  ...[1, 2, 3, 4, 5, 6].map(i => ({ key: `24_Additional_Houses/24_Terraced_House_${i}`, front: 'house' as const, doors: [4], weight: 0.4 })),
  { key: '24_Additional_Houses/24_Victorian_House_7', front: 'house', doors: [3], weight: 0.6 },
];

export function singleBuilding(r: Rng, filter?: (s: typeof SINGLES[number]) => boolean): BuildingPlan {
  const pool = SINGLES.filter(s => hasSprite(s.key) && (!filter || filter(s)));
  const s = r.choose('bld.single', {}, { weights: pool.map(p => [p, p.weight] as const) });
  const sp = spr(s.key);
  const h = sp.h / TILE;
  return { id: `b${nextId++}`, w: sp.w / TILE, h, foot: Math.max(3, Math.min(h - 2, Math.round(h * 0.5))), parts: [{ key: s.key, dx: 0, dy: 0, sub: 0, role: 'whole' }],
    doors: s.doors.map(d => d * TILE), front: s.front, tall: sp.h / TILE >= 14, label: s.key.split('/')[1] };
}

/** any building fitting width <= maxW and height in [minH, maxH] (cells), weighted towards the theme mix.
 *  `fronts` restricts the kind (e.g. interior rows: residential only). */
export function pickBuilding(r: Rng, maxW: number, minH: number, maxH: number, mix: { modular: number; single: number }, fronts?: FrontKind[]): BuildingPlan | null {
  const resOnly = fronts && fronts.every(f => f === 'condo' || f === 'house');
  for (let tries = 0; tries < 40; tries++) {
    const m = r.mark();
    const floors = maxH < 13 ? 0 : r.choose('bld.floorsFit', { maxH }, { weights: maxH < 17 ? [[0, 2], [1, 4]] as const : [[0, 1], [1, 4], [2, 3], [3, 1]] as const });
    const b = r.choose('bld.modularOrSingle', { resOnly: !!resOnly }, { weights: [['m', mix.modular], ['s', mix.single]] as const }) === 'm'
      ? modularStack(r, { floors, front: resOnly ? 'condo' : undefined })
      : singleBuilding(r, fronts ? s => fronts.includes(s.front) : undefined);
    if (b.w <= maxW && b.h <= maxH && b.h >= minH && (!fronts || fronts.includes(b.front))) return b;
    r.reject(m, 'building:size');
  }
  return null;
}

/** composite buildings (exp-04, adopted) number apart ("e<n>"): ids are stream labels (D23), so they must not shift the others */
let nextExpId = 0;
export const expId = () => `e${nextExpId++}`;

export function resetIds() { nextId = 0; nextExpId = 0; }
