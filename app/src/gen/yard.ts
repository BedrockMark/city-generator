// Courtyard / leftover space allocation. Every yard cell gets a purpose: each yard component is cut into
// rectangles (largest first) and each rectangle becomes parking (with a driveway to the street), a garden,
// a forecourt for the building it fronts, a passage, a green strip, a service corner or a backyard.
// Yard includes the ground hidden behind buildings (sprite rows above the roof-sized footprint): that ground
// gets backyard life too, visible in the viewer's ghost mode.
import { Rng } from './rng';
import { paintWalkCell, asphalt, slab, type Layout } from './layout';
import type { BlockPlan, PlacedBuilding } from './block';
import { SceneBuilder, rect } from './place';
import { spr, variants, hasSprite } from './assets';
import { makePerson, frameFor } from './people';
import { person } from './vignettes';
import { TILE } from './types';

const C = '3_City_Props/';
const V = '10_Vehicles/';
const G = '17_Garden/';
const T = TILE;

export type CellRect = { x: number; y: number; w: number; h: number };
type Kind = 'parking' | 'garden' | 'forecourt' | 'passage' | 'strip' | 'service' | 'backyard' | 'paved';

/** largest axis-aligned rectangle of cells satisfying ok() inside the bbox of `cells` (histogram method) */
export function bestRect(cells: [number, number][], ok: (x: number, y: number) => boolean): CellRect | null {
  if (!cells.length) return null;
  let best: CellRect | null = null;
  const xs = cells.map(c => c[0]), ys = cells.map(c => c[1]);
  const X0 = Math.min(...xs), X1 = Math.max(...xs), Y0 = Math.min(...ys), Y1 = Math.max(...ys);
  const hgt = new Map<number, number>();
  for (let y = Y0; y <= Y1; y++) {
    for (let x = X0; x <= X1; x++) hgt.set(x, ok(x, y) ? (hgt.get(x) ?? 0) + 1 : 0);
    for (let x = X0; x <= X1; x++) {
      let h = hgt.get(x)!;
      for (let x2 = x; x2 <= X1 && hgt.get(x2)! > 0; x2++) {
        h = Math.min(h, hgt.get(x2)!);
        const w = x2 - x + 1;
        if (!best || w * h > best.w * best.h) best = { x, y: y - h + 1, w, h };
      }
    }
  }
  return best;
}

const cellsOf = (rc: CellRect) => { const o: [number, number][] = []; for (let y = rc.y; y < rc.y + rc.h; y++) for (let x = rc.x; x < rc.x + rc.w; x++) o.push([x, y]); return o; };

export function yardSpaces(L: Layout, plan: BlockPlan, sb: SceneBuilder, r: Rng) {
  const yardStyle = r.pick(['sidewalk_brown', 'sidewalk_grey', 'sidewalk_beige', 'sidewalk_lightgrey'].filter(s => s !== L.mainStyle));
  const free = plan.yard.map(row => [...row]);
  for (let y = 0; y < L.rows; y++) for (let x = 0; x < L.cols; x++) if (free[y][x]) L.base[y][x] = slab(yardStyle, x, y);
  const isWalk = (x: number, y: number) => L.cls[y]?.[x] === 'walk';
  const used = { parking: 0, garden: 0, service: 0, backyard: 0 };
  const rects: { rc: CellRect; kind: Kind; b?: PlacedBuilding; side?: 'N' | 'S' | 'E' | 'W' }[] = [];
  // ---- cut rectangles, biggest first, across all components ----
  // visible ground first (parking, gardens, strips ...), then the ground hidden behind buildings (backyards)
  let hiddenPass = false;
  for (let guard = 0; guard < 120; guard++) {
    const avail = (x: number, y: number) => free[y]?.[x] === true && plan.hidden[y][x] === hiddenPass;
    const cells: [number, number][] = [];
    for (let y = 0; y < L.rows; y++) for (let x = 0; x < L.cols; x++) if (avail(x, y)) cells.push([x, y]);
    const rc = bestRect(cells, avail);
    if (!rc || rc.w * rc.h < 2) { if (hiddenPass) break; hiddenPass = true; continue; }
    for (const [x, y] of cellsOf(rc)) free[y][x] = false;
    const hid = cellsOf(rc).filter(([x, y]) => plan.hidden[y][x]).length / (rc.w * rc.h);
    const sideFrac = (s: 'N' | 'S' | 'E' | 'W') => {
      const line = s === 'N' || s === 'S' ? Array.from({ length: rc.w }, (_, i) => [rc.x + i, s === 'N' ? rc.y - 1 : rc.y + rc.h] as const)
        : Array.from({ length: rc.h }, (_, i) => [s === 'W' ? rc.x - 1 : rc.x + rc.w, rc.y + i] as const);
      return line.filter(([x, y]) => isWalk(x, y)).length / line.length;
    };
    const street = (['S', 'W', 'E', 'N'] as const).filter(s => sideFrac(s) > 0.5);
    // the building whose facade this rect lies in front of
    const fronted = plan.buildings.find(b => b.cy + b.plan.h === rc.y && b.cx < rc.x + rc.w && rc.x < b.cx + b.plan.w);
    let kind: Kind;
    if (fronted && rc.h <= 3 && hid < 0.3 && street.includes('S')) kind = 'forecourt';
    else if (hid >= 0.5) kind = used.backyard++ < 4 ? 'backyard' : 'paved';
    else if (!used.parking && rc.w >= 9 && rc.h >= 7 && r.chance(0.75) && parking(L, sb, r.fork(`park${rc.x},${rc.y}`), rc, plan, free)) { used.parking++; continue; }
    else if (Math.min(rc.w, rc.h) >= 3 && rc.w * rc.h >= 15 && used.garden < 2) { kind = 'garden'; used.garden++; }
    else if (Math.min(rc.w, rc.h) <= 2 && street.length > 0) kind = rc.w <= 2 && rc.h >= 3 && street.includes('S') && !street.includes('E') && !street.includes('W') ? 'passage' : 'strip';
    else if (Math.max(rc.w, rc.h) >= 3 && Math.min(rc.w, rc.h) <= 3) kind = 'strip';
    else if (rc.w * rc.h >= 4 && used.service < 2) { kind = 'service'; used.service++; }
    else kind = 'paved';
    rects.push({ rc, kind, b: fronted, side: street[0] });
  }
  for (const { rc, kind, b, side } of rects) {
    const rr = r.fork(`${kind}${rc.x},${rc.y}`);
    if (kind === 'garden') garden(L, sb, rr, rc, side, plan);
    else if (kind === 'forecourt') forecourt(L, sb, rr, rc, b!);
    else if (kind === 'passage') passage(sb, rr, rc);
    else if (kind === 'strip') strip(L, sb, rr, rc, side, plan);
    else if (kind === 'service') service(sb, rr, rc);
    else if (kind === 'backyard') backyard(sb, rr, rc);
    else if (kind === 'paved' && rc.w * rc.h >= 2 && rr.chance(0.5)) sb.putFoot(rr.pick(variants('17_Garden/Bush_Potted')), (rc.x + 0.5) * T, (rc.y + 1) * T - 2, 'plant', { group: 'yard' });
  }
}

// ------------------------------------------------------------------------------------------------
// parking lot with a driveway

type Drive = { cells: [number, number][]; side: 'N' | 'S' | 'E' | 'W'; at: number };

/** a 2-cell-wide driveway from the lot edge through yard / sidewalk cells to the road (shortest wins) */
function findDrive(L: Layout, plan: BlockPlan, rc: CellRect, bayCols: (c: number) => boolean): Drive | null {
  const passable = (x: number, y: number) => {
    const c = L.cls[y]?.[x];
    if (c === 'walk') return 'walk';
    if (c === 'lot' && plan.yard[y][x] && !plan.hidden[y][x]) return 'lot';
    return null;
  };
  const trace = (x0: number, y0: number, dx: number, dy: number, w: [number, number]): [number, number][] | null => {
    const out: [number, number][] = [];
    let walk = 0;
    for (let k = 0; k < 8; k++) {
      const cells: [number, number][] = [[x0 + dx * k + w[0] * 0, y0 + dy * k], [x0 + dx * k + w[0], y0 + dy * k + w[1]]];
      if (cells.every(([x, y]) => L.cls[y]?.[x] === 'road')) return walk > 0 ? out : null;
      for (const [x, y] of cells) { const p = passable(x, y); if (!p) return null; if (p === 'walk') walk++; out.push([x, y]); }
    }
    return null;
  };
  const cands: Drive[] = [];
  const aisle = rc.y + 5;   // bays occupy the top 5 rows
  for (let x = rc.x; x < rc.x + rc.w - 1; x++) { const c = trace(x, rc.y + rc.h, 0, 1, [1, 0]); if (c) cands.push({ cells: c, side: 'S', at: x }); }
  if (rc.h >= 7) {
    const cw = trace(rc.x - 1, aisle, -1, 0, [0, 1]); if (cw) cands.push({ cells: cw, side: 'W', at: aisle });
    const ce = trace(rc.x + rc.w, aisle, 1, 0, [0, 1]); if (ce) cands.push({ cells: ce, side: 'E', at: aisle });
  }
  for (const x of [rc.x, rc.x + rc.w - 2]) if (!bayCols(x) && !bayCols(x + 1)) { const c = trace(x, rc.y - 1, 0, -1, [1, 0]); if (c) cands.push({ cells: c, side: 'N', at: x }); }
  if (!cands.length) return null;
  cands.sort((a, b) => a.cells.length - b.cells.length);
  return cands[0];
}

function parking(L: Layout, sb: SceneBuilder, rr: Rng, rc: CellRect, plan: BlockPlan, free: boolean[][]): boolean {
  // bays: 2_City_Terrains cols 0-8 rows 8-12 = three perpendicular bays with a curb on top; pushed to one end so
  // a north driveway can use the other end
  const nPieces = Math.floor(rc.w / 9);
  const slack = rc.w - nPieces * 9;
  const leftAlign = rr.chance(0.5);
  const px0 = rc.x + (slack >= 2 ? (leftAlign ? 0 : slack) : Math.floor(slack / 2));
  const bayCols = (c: number) => c >= px0 && c < px0 + nPieces * 9;
  const drive = findDrive(L, plan, rc, bayCols);
  if (!drive) return false;
  for (const [x, y] of cellsOf(rc)) L.base[y][x] = asphalt(rr);
  for (let p = 0; p < nPieces; p++) for (let j = 0; j < 5; j++) for (let i = 0; i < 9; i++) L.base[rc.y + j][px0 + p * 9 + i] = ['city', i, 8 + j];
  // driveway: sidewalk cells become road (the autotile then draws the curb cut), yard cells get asphalt
  for (const [x, y] of drive.cells) { if (L.cls[y][x] === 'walk') L.cls[y][x] = 'road'; L.base[y][x] = asphalt(rr); plan.yard[y][x] = false; free[y][x] = false; }
  for (const [x, y] of drive.cells) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const c = L.cls[y + dy]?.[x + dx]; if (c === 'walk') paintWalkCell(L, x + dx, y + dy);
  }
  const xs = drive.cells.map(c => c[0]), ys = drive.cells.map(c => c[1]);
  const [dx0, dx1, dy0, dy1] = [Math.min(...xs), Math.max(...xs) + 1, Math.min(...ys), Math.max(...ys) + 1];
  // keep the driveway and its mouth in the road clear (no parked cars, no curb furniture)
  const grow = { N: [0, -2, 0, 0], S: [0, 0, 0, 2], W: [-2, 0, 0, 0], E: [0, 0, 2, 0] }[drive.side];
  sb.clear(rect((dx0 + grow[0]) * T - 6, (dy0 + grow[1]) * T - 6, (dx1 + grow[2]) * T + 6, (dy1 + grow[3]) * T + 6), 'drive');
  // aisle stays clear
  sb.clear(rect(rc.x * T, (rc.y + 5) * T, (rc.x + rc.w) * T, (rc.y + rc.h) * T), 'aisle');
  const carsKeys = variants(V + 'Car_Down').filter(k => spr(k).w <= 48 && spr(k).h <= 80);
  for (let p = 0; p < nPieces; p++) for (let b = 0; b < 3; b++) {
    if (!rr.chance(0.6)) continue;
    const cx = (px0 + p * 9 + 1.5 + b * 3) * T, by = (rc.y + 5) * T - 3;
    sb.putFoot(rr.pick(carsKeys), cx, by, 'vehicle', { group: 'parking_lot', depth: 40, ignoreClear: true });
  }
  // someone walking to their car
  if (rr.chance(0.6)) {
    const p = makePerson(rr, 'citizen');
    sb.putChar(p.layers, frameFor(p, 'walk', rr.pick(['left', 'right'] as const), rr), (rc.x + rr.int(1, rc.w - 2)) * T, (rc.y + 6) * T + 4, 'citizen', { group: 'parking_lot' });
  }
  return true;
}

// ------------------------------------------------------------------------------------------------

/** grass 9-slice (1_Terrains cols 0-2, rows 11-13, transparent edges) */
function grass(L: Layout, rc: CellRect) {
  for (let y = rc.y; y < rc.y + rc.h; y++) for (let x = rc.x; x < rc.x + rc.w; x++) {
    const cx = rc.w === 1 ? 1 : x === rc.x ? 0 : x === rc.x + rc.w - 1 ? 2 : 1;
    const cy = rc.h === 1 ? 12 : y === rc.y ? 11 : y === rc.y + rc.h - 1 ? 13 : 12;
    L.over[y][x] = ['terr', cx, cy];
  }
}

const SMALL_TREES = [C + 'Tree_1', C + 'Tree_2', C + 'Tree_3', C + 'Tree_4', C + 'Tree_8'];

/** a little park: grass split by a path from the street gate, benches facing the path, trees on the grass */
function garden(L: Layout, sb: SceneBuilder, rr: Rng, rc: CellRect, side: 'N' | 'S' | 'E' | 'W' | undefined, plan: BlockPlan) {
  const vertical = side ? side === 'N' || side === 'S' : rc.h > rc.w;
  const len = vertical ? rc.w : rc.h;
  const pathAt = (vertical ? rc.x : rc.y) + Math.max(1, Math.min(len - 2, Math.floor(len / 2) + rr.int(-1, 1)));
  const halves: CellRect[] = vertical
    ? [{ x: rc.x, y: rc.y, w: pathAt - rc.x, h: rc.h }, { x: pathAt + 1, y: rc.y, w: rc.x + rc.w - pathAt - 1, h: rc.h }]
    : [{ x: rc.x, y: rc.y, w: rc.w, h: pathAt - rc.y }, { x: rc.x, y: pathAt + 1, w: rc.w, h: rc.y + rc.h - pathAt - 1 }];
  const pathStyle = rr.pick(['sidewalk_beige', 'sidewalk_lightbeige', 'sidewalk_brown']);
  if (vertical) for (let y = rc.y; y < rc.y + rc.h; y++) L.base[y][pathAt] = slab(pathStyle, pathAt, y);
  else for (let x = rc.x; x < rc.x + rc.w; x++) L.base[pathAt][x] = slab(pathStyle, x, pathAt);
  for (const h of halves) if (h.w > 0 && h.h > 0) grass(L, h);
  // path stays walkable
  sb.clear(vertical ? rect(pathAt * T + 2, rc.y * T, (pathAt + 1) * T - 2, (rc.y + rc.h) * T) : rect(rc.x * T, pathAt * T + 2, (rc.x + rc.w) * T, (pathAt + 1) * T - 2), 'path');
  // benches face the path with their sitters; one style per garden
  const nB = rr.int(1, 2);
  let prevSide = rr.chance(0.5);
  for (let i = 0; i < nB; i++) {
    if (vertical) {
      const leftSide = i === 0 ? prevSide : !prevSide;
      const by = (rc.y + rr.int(1, Math.max(1, rc.h - 3))) * T + 44;
      if (by > (rc.y + rc.h) * T) continue;
      const key = leftSide ? rr.pick([C + 'Bench_4', C + 'Bench_6']) : rr.pick([C + 'Bench_3', C + 'Bench_5']);
      const bx = leftSide ? pathAt * T - 8 : (pathAt + 1) * T + 8;
      if (sb.putFoot(key, bx, by, 'bench', { group: 'garden' }) && rr.chance(0.6))
        { const p = makePerson(rr, 'resident'); sb.putChar(p.layers, frameFor(p, 'sit', leftSide ? 'right' : 'left'), bx + (leftSide ? 1 : -1), by - 12, 'resident', { group: 'garden', force: true }); }
    } else {
      const above = i === 0 ? prevSide : !prevSide;
      const bx = (rc.x + rr.int(1, Math.max(1, rc.w - 3))) * T + 16;
      const key = above ? rr.pick([C + 'Bench_1', C + 'Bench_2']) : C + 'Bench_7';
      const by = above ? pathAt * T - 1 : (pathAt + 1) * T + 30;
      if (by > (rc.y + rc.h) * T + 2 || by - 30 < rc.y * T) continue;
      sb.putFoot(key, bx, by, 'bench', { group: 'garden' });
    }
  }
  // trees on the grass, irregular but spaced
  const trees = SMALL_TREES.filter(hasSprite);
  const nT = Math.max(1, Math.round(rc.w * rc.h / 12));
  for (let i = 0, ok = 0; i < nT * 4 && ok < nT; i++) {
    const h = rr.pick(halves); if (h.w < 1 || h.h < 2) continue;
    const fx = (h.x + rr.range(0.5, h.w - 0.5)) * T, fy = (h.y + rr.int(2, h.h)) * T - rr.int(3, 10);
    if (sb.putFoot(rr.pick(trees), fx, fy, 'tree', { group: 'garden', pad: 6 })) ok++;
  }
  for (let i = 0; i < rr.int(0, 3); i++) { const h = rr.pick(halves); if (h.w >= 2 && h.h >= 1) sb.putFoot(rr.pick(variants(C + 'Flower_Bush')), (h.x + rr.int(1, h.w - 1)) * T, (h.y + rr.int(1, h.h)) * T - 2, 'plant', { group: 'garden' }); }
  if (rr.chance(0.4)) { const p = makePerson(rr, 'kid', { kid: true }); const h = rr.pick(halves); if (h.w > 0 && h.h > 0) sb.putChar(p.layers, frameFor(p, 'stand', rr.pick(['down', 'left', 'right'] as const)), (h.x + rr.range(0.5, h.w - 0.5)) * T, (h.y + rr.int(1, h.h)) * T - 2, 'kid', { group: 'garden' }); }
  if (rr.chance(0.5)) { const p = makePerson(rr, 'citizen'); const q = (vertical ? rc.y : rc.x) + rr.int(0, (vertical ? rc.h : rc.w) - 1);
    const [fx, fy] = vertical ? [(pathAt + 0.5) * T, (q + 1) * T - 3] : [(q + 0.5) * T, (pathAt + 1) * T - 3];
    sb.putChar(p.layers, frameFor(p, 'walk', vertical ? rr.pick(['up', 'down'] as const) : rr.pick(['left', 'right'] as const), rr), fx, fy, 'citizen', { group: 'garden' }); }
  if (side) fence(L, sb, rr, rc, side, pathAt, vertical, plan);
}

/** fence along the street side(s), opening where the path meets the street */
function fence(L: Layout, sb: SceneBuilder, rr: Rng, rc: CellRect, side: 'N' | 'S' | 'E' | 'W', pathAt: number, vertical: boolean, plan: BlockPlan) {
  if (!rr.chance(0.7)) return;
  const set = rr.int(1, 6);
  const F = (part: string) => `24_Additional_Houses/24_Fence_${set}_${part}`;
  const put = (key: string, x: number, y: number) => { if (hasSprite(key)) sb.putAt(key, x * T, y * T, 'fence', { group: 'fence', depth: 6, ignoreClear: true }); };
  void plan;
  if (side === 'N') {
    for (let x = rc.x; x < rc.x + rc.w; x++) {
      if (vertical && x === pathAt) continue;
      put(F(x === rc.x ? 'Top_Left' : x === rc.x + rc.w - 1 ? 'Top_Right' : 'Top_Middle'), x, rc.y);
    }
  } else if (side === 'W' || side === 'E') {
    const x = side === 'W' ? rc.x : rc.x + rc.w - 1;
    for (let y = rc.y; y < rc.y + rc.h; y++) { if (!vertical && y === pathAt) continue; put(F(side === 'W' ? 'Middle_Left' : 'Middle_Right'), x, y); }
  }
  // south sides stay open (fences there would hide the garden behind a wall in this view)
}

/** forecourt in front of a set-back building: what that building would do with the space */
function forecourt(L: Layout, sb: SceneBuilder, rr: Rng, rc: CellRect, b: PlacedBuilding) {
  const door = b.cx * T + (b.plan.doors[0] ?? b.plan.w * T / 2);
  const g = b.plan.id;
  const paved = b.plan.front !== 'condo' && b.plan.front !== 'house';
  for (const [x, y] of cellsOf(rc)) L.base[y][x] = slab(paved ? L.mainStyle : 'sidewalk_lightgrey', x, y);
  sb.clear(rect(door - 12, rc.y * T, door + 12, (rc.y + rc.h) * T), 'door');
  const x0 = rc.x * T, x1 = (rc.x + rc.w) * T, y1 = (rc.y + rc.h) * T;
  switch (b.plan.front) {
    case 'cafe': case 'bakery': {
      // terrace: tables with chairs and customers filling the setback
      const table = rr.pick(variants(V + 'Street_Food_Table'));
      for (let tx = x0 + 18; tx < x1 - 14; tx += rr.int(36, 44)) {
        const ty = rc.y * T + (rc.h >= 2 ? rr.int(22, 26) : 14);
        if (!sb.putFoot(table, tx, ty, 'table', { group: g })) continue;
        for (const [sx, dir] of [[-12, 'right'], [12, 'left']] as const) {
          if (rr.chance(0.55)) { if (!person(sb, rr, tx + sx, ty - 1, 'sit', dir, 'customer', g)) sb.putFoot(V + 'Street_Food_Chair_1', tx + sx, ty - 2, 'chair', { group: g }); }
          else sb.putFoot(V + 'Street_Food_Chair_1', tx + sx, ty - 2, 'chair', { group: g });
        }
      }
      break;
    }
    case 'retail': case 'hardware': case 'market': case 'gym': case 'closed': {
      // planters framing the entrance, a bench, sale crates / boxes on display, browsing customers
      const pot = rr.pick(variants('17_Garden/Bush_Potted'));
      for (let x = x0 + 8; x < x1; x += rr.int(28, 48)) sb.putFoot(pot, x, y1 - 3, 'plant', { group: g });
      if (rr.chance(0.6)) sb.putFoot(C + 'Bench_1', door + (rr.chance(0.5) ? 34 : -34), rc.y * T + 28, 'bench', { group: g });
      if (b.plan.front !== 'gym' && rr.chance(0.6)) for (let i = 0; i < rr.int(1, 3); i++) sb.putFoot(rr.pick(variants('6_Garage_Sales/Box')), door + (rr.chance(0.5) ? 1 : -1) * rr.int(24, 56), rc.y * T + 14, 'crate', { group: g });
      for (let i = 0; i < rr.int(0, 2); i++) person(sb, rr, door + rr.int(-40, 40), rc.y * T + rr.int(14, 24), 'stand', 'up', 'customer', g);
      break;
    }
    default: {
      // front garden: lawn either side of the door path, flowers along the facade, mailbox at the path
      const dc = Math.floor(door / T);
      if (dc - 1 >= rc.x) grass(L, { x: rc.x, y: rc.y, w: dc - rc.x, h: rc.h });
      if (dc + 1 < rc.x + rc.w) grass(L, { x: dc + 1, y: rc.y, w: rc.x + rc.w - dc - 1, h: rc.h });
      const fl = rr.pick(variants(C + 'Flower_Bush'));
      for (let x = x0 + 14; x < x1 - 8; x += rr.int(30, 44)) sb.putFoot(fl, x, rc.y * T + 14, 'plant', { group: g });
      if (rr.chance(0.6)) sb.putFoot(C + 'Mailbox_1', door + 18, y1 - 2, 'utility', { group: g });
      if (rr.chance(0.4)) sb.putFoot(rr.pick(SMALL_TREES), rr.chance(0.5) ? x0 + 10 : x1 - 10, y1 - 3, 'tree', { group: g });
    }
  }
}

/** narrow way between buildings: kept clear; a bin pushed against the wall at the far end, maybe laundry */
function passage(sb: SceneBuilder, rr: Rng, rc: CellRect) {
  const x0 = rc.x * T, x1 = (rc.x + rc.w) * T;
  sb.clear(rect(x0 + 2, (rc.y + 1) * T, x1 - 2, (rc.y + rc.h) * T + 2 * T), 'passage');
  const top = rc.y * T + 14;
  if (rc.h >= 4 && rr.chance(0.7)) sb.putFoot(rr.pick(variants(C + 'Trashbin')), rc.w >= 2 ? x0 + 8 : x0 + 8, top, 'trash', { group: 'passage', ignoreClear: true });
  if (rc.w >= 2 && rr.chance(0.5)) sb.putFoot(rr.pick(variants(C + 'Trash')), x1 - 6, top + 4, 'trash', { group: 'passage', ignoreClear: true });
  if (rr.chance(0.25)) person(sb, rr, x0 + rc.w * 8, (rc.y + rr.int(1, rc.h - 1)) * T + 8, 'phone', 'down', 'citizen', 'passage');
}

/** green strip: lawn with a hedge row / shrubs / small trees, or a row of potted plants on a narrow paved strip */
function strip(L: Layout, sb: SceneBuilder, rr: Rng, rc: CellRect, side: 'N' | 'S' | 'E' | 'W' | undefined, plan: BlockPlan) {
  void plan;
  const horiz = rc.w >= rc.h;
  if (Math.min(rc.w, rc.h) === 1 && rr.chance(0.5)) {
    const pot = rr.pick(variants('17_Garden/Bush_Potted'));
    if (horiz) for (let x = rc.x * T + 8; x < (rc.x + rc.w) * T - 4; x += rr.int(24, 40)) sb.putFoot(pot, x, (rc.y + 1) * T - 2, 'plant', { group: 'strip' });
    else for (let y = (rc.y + 1) * T - 2; y <= (rc.y + rc.h) * T; y += rr.int(24, 40)) sb.putFoot(pot, (rc.x + 0.5) * T, y, 'plant', { group: 'strip' });
    return;
  }
  grass(L, rc);
  const shrubs = horiz ? ['Bush_14', 'Bush_15', 'Bush_18', 'Bush_19', 'Bush_22'].map(k => G + k) : ['Bush_16', 'Bush_17', 'Bush_10', 'Bush_11'].map(k => G + k);
  const pool = [...shrubs.filter(hasSprite), ...(Math.min(rc.w, rc.h) >= 2 ? SMALL_TREES.filter(hasSprite) : [])];
  const L0 = horiz ? rc.x * T : rc.y * T, L1 = horiz ? (rc.x + rc.w) * T : (rc.y + rc.h) * T;
  for (let s = L0 + rr.int(6, 18); s < L1 - 6; s += rr.int(20, 44)) {
    const key = rr.pick(pool);
    const [fx, fy] = horiz ? [s, (rc.y + rc.h) * T - rr.int(3, 8)] : [(rc.x + rc.w / 2) * T + rr.jitter(3), s + 16];
    sb.putFoot(key, fx, fy, key.includes('Tree') ? 'tree' : 'plant', { group: 'strip', pad: 2 });
  }
  void side;
}

/** service corner: dumpsters against the back edge, bags, boxes */
function service(sb: SceneBuilder, rr: Rng, rc: CellRect) {
  const nd = Math.min(rr.int(1, 3), Math.max(1, Math.floor(rc.w / 2)));
  const x0 = rc.x * T, y = rc.y * T + 30;
  for (let i = 0; i < nd; i++) sb.putFoot(rr.pick(variants(C + 'Dumpster')), x0 + 16 + i * 32, Math.min(y, (rc.y + rc.h) * T - 2), 'trash', { group: 'service' });
  for (let i = 0; i < rr.int(1, 3); i++) sb.putFoot(rr.pick(variants(C + 'Trash')), x0 + rr.int(4, Math.max(5, rc.w * T - 4)), (rc.y + rc.h) * T - rr.int(2, 8), 'trash', { group: 'service' });
  if (rr.chance(0.5)) sb.putFoot(rr.pick(variants('6_Garage_Sales/Box')), x0 + rr.int(8, Math.max(9, rc.w * T - 8)), (rc.y + rc.h) * T - 2, 'crate', { group: 'service' });
}

/** ground behind a building: AC units, laundry, crates, barrels, a smoker on a break */
function backyard(sb: SceneBuilder, rr: Rng, rc: CellRect) {
  const x0 = rc.x * T, x1 = (rc.x + rc.w) * T, y0 = rc.y * T, y1 = (rc.y + rc.h) * T;
  const ac = ['6_Garage_Sales/Air_Conditioner_Unit_1', '6_Garage_Sales/Air_Conditioner_Unit_2', '6_Garage_Sales/Air_Conditioner_Unit_3', '9_Shopping_Center_and_Markets/Air_Conditioner_Unit_3', '9_Shopping_Center_and_Markets/Air_Conditioner_Unit_4'].filter(hasSprite);
  const items: [string[], string, number][] = [
    [ac, 'utility', 3], [variants(C + 'Hanging_Clothes'), 'utility', 2], [variants('6_Garage_Sales/Box'), 'crate', 2],
    [variants(C + 'Dumpster'), 'trash', 1.5], [variants(C + 'Trash'), 'trash', 1], [[C + 'Barrel_1', C + 'Barrel_2', C + 'Barrel_5'].filter(hasSprite), 'crate', 1],
    [variants('17_Garden/Bush_Potted'), 'plant', 1],
  ];
  const n = Math.max(2, Math.min(7, Math.round(rc.w * rc.h / 8)));
  for (let i = 0, k = 0; i < n * 3 && k < n; i++) {
    const [pool, cls] = rr.weighted(items.map(it => [[it[0], it[1]] as const, it[2]] as const));
    if (!pool.length) continue;
    // against the back wall (top) or along the sides, rarely in the middle
    const fx = rr.chance(0.6) ? x0 + rr.int(10, Math.max(11, x1 - x0 - 10)) : (rr.chance(0.5) ? x0 + 10 : x1 - 10);
    const fy = rr.chance(0.6) ? y0 + rr.int(18, 26) : y0 + rr.int(18, Math.max(19, y1 - y0 - 2));
    if (fy > y1) continue;
    if (sb.putFoot(rr.pick(pool), fx, fy, cls, { group: 'backyard', pad: 2 })) k++;
  }
  if (rr.chance(0.5)) person(sb, rr, x0 + rr.int(10, Math.max(11, x1 - x0 - 10)), y0 + rr.int(24, Math.max(25, y1 - y0 - 4)), rr.pick(['phone', 'stand'] as const), rr.pick(['left', 'right', 'down'] as const), 'resident', 'backyard');
}
