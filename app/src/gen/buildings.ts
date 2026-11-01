// Building factory: modular floor stacks (5_Floor_Modular) and complete single-sprite buildings.
import { Rng } from './rng';
import { MODULAR, spr, hasSprite, type ModPiece } from './assets';
import { TILE } from './types';

export type FrontKind = 'cafe' | 'bakery' | 'retail' | 'closed' | 'gym' | 'condo' | 'market' | 'house' | 'hardware';

export interface BuildingPlan {
  id: string;
  w: number; h: number;                    // cells (full sprite rect)
  /** footprint depth in cells (bottom rows of the sprite rect); the rows above are ground hidden behind the building */
  foot: number;
  parts: { key: string; dx: number; dy: number; sub: number }[];   // px offsets from top-left
  doors: number[];                         // door centre x offsets (px) on the bottom edge
  front: FrontKind;
  tall: boolean;
  label: string;
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
export function modularStack(r: Rng, opts: { floors?: number; front?: FrontKind; colour?: 'red' | 'blue' | 'grey'; avoidFamily?: string } = {}): BuildingPlan {
  const colour = opts.colour ?? r.pick(['red', 'blue', 'grey'] as const);
  const famPool = GF_FAMILIES.filter(f => (!opts.front || f.front === opts.front || (opts.front === 'closed' && f.front === 'retail')) && !(opts.avoidFamily && f.fam.endsWith(opts.avoidFamily)));
  const fam = r.weighted((famPool.length ? famPool : GF_FAMILIES).map(f => [f, f.w] as const));
  const gfAll = pieces(fam.fam, colour);
  // odd variants are open storefronts, even ones shuttered (verified on the contact sheets)
  const wantClosed = opts.front === 'closed' || (fam.front !== 'condo' && r.chance(0.15));
  const gfPool = gfAll.filter(p => fam.front === 'condo' || ((p.v % 2 === 0) === wantClosed));
  const gf = r.pick(gfPool.length ? gfPool : gfAll);
  const floors = opts.floors ?? r.weighted([[0, 2], [1, 4], [2, 3], [3, 1]] as const);
  const mids = Array.from({ length: floors }, () => r.pick(pieces('Middle_Floor', colour)));
  // repeat the same middle floor most of the time (as in the refs), sometimes mix
  if (floors > 1 && r.chance(0.6)) mids.fill(mids[0]);
  const roof = r.pick(pieces('Roof'));
  const roofH = spr(roof.key).h / TILE;
  const parts: BuildingPlan['parts'] = [];
  let y = 0, sub = 0;
  parts.push({ key: roof.key, dx: 0, dy: y, sub: sub++ }); y += roofH * TILE;
  for (const m of mids) { parts.push({ key: m.key, dx: 0, dy: y, sub: sub++ }); y += 4 * TILE; }
  const gfS = spr(gf.key);
  parts.push({ key: gf.key, dx: 0, dy: y - (gfS.h - 3 * TILE), sub: sub++ });
  y += 3 * TILE;
  const front: FrontKind = fam.front === 'condo' ? 'condo' : wantClosed ? 'closed' : fam.front;
  // footprint = roof size: in this 3/4 view the roof is the building's plan
  return { id: `b${nextId++}`, w: 7, h: y / TILE, foot: Math.min(roofH, y / TILE), parts, doors: [fam.door * TILE], front, tall: floors >= 2,
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
  const s = r.weighted(pool.map(p => [p, p.weight] as const));
  const sp = spr(s.key);
  const h = sp.h / TILE;
  return { id: `b${nextId++}`, w: sp.w / TILE, h, foot: Math.max(3, Math.min(h - 2, Math.round(h * 0.5))), parts: [{ key: s.key, dx: 0, dy: 0, sub: 0 }],
    doors: s.doors.map(d => d * TILE), front: s.front, tall: sp.h / TILE >= 14, label: s.key.split('/')[1] };
}

/** any building fitting width <= maxW and height in [minH, maxH] (cells), weighted towards the theme mix.
 *  `fronts` restricts the kind (e.g. interior rows: residential only). */
export function pickBuilding(r: Rng, maxW: number, minH: number, maxH: number, mix: { modular: number; single: number }, fronts?: FrontKind[]): BuildingPlan | null {
  const resOnly = fronts && fronts.every(f => f === 'condo' || f === 'house');
  for (let tries = 0; tries < 40; tries++) {
    const floors = maxH < 13 ? 0 : maxH < 17 ? r.weighted([[0, 2], [1, 4]] as const) : r.weighted([[0, 1], [1, 4], [2, 3], [3, 1]] as const);
    const b = r.weighted([['m', mix.modular], ['s', mix.single]] as const) === 'm'
      ? modularStack(r, { floors, front: resOnly ? 'condo' : undefined })
      : singleBuilding(r, fronts ? s => fronts.includes(s.front) : undefined);
    if (b.w <= maxW && b.h <= maxH && b.h >= minH && (!fronts || fronts.includes(b.front))) return b;
  }
  return null;
}

export function resetIds() { nextId = 0; }
