// Functional groups ("vignettes") and the curb rhythm strip. Each placement has a reason:
// crossings -> traffic lights at both ends; doors -> what that kind of shop puts outside; alleys -> bins;
// curb strip -> trees/lamps/bollards with a per-street beat, interrupted by crossings, doors, bus stops.
import { Rng } from './rng';
import type { Layout } from './layout';
import type { BlockPlan, PlacedBuilding } from './block';
import { SceneBuilder, rect } from './place';
import { spr, variants, hasSprite } from './assets';
import { makePerson, frameFor, type Dir, type Pose } from './people';
import { TILE } from './types';
import { slab } from './layout';

const C = '3_City_Props/';
const V = '10_Vehicles/';
const T = TILE;

export function person(sb: SceneBuilder, r: Rng, fx: number, fy: number, pose: Pose, dir: Dir, role = 'citizen', group?: string, kid = false) {
  const p = makePerson(r, role, { kid });
  return sb.putChar(p.layers, frameFor(p, pose, dir, r), fx, fy, role, { group });
}

// ------------------------------------------------------------------------------------------------
// curb runs: straight sequences of sidewalk cells that touch the road on one side

export interface CurbRun { side: 'S' | 'N' | 'E' | 'W'; main: boolean; fixed: number; curb: number; a: number; b: number; region: number; sw: number }
// side = where the ROAD is relative to the sidewalk. fixed = furniture foot line (px); curb = px of the curb line; a..b = px range along;
// sw = sidewalk depth in cells

export function curbRuns(L: Layout): CurbRun[] {
  const out: CurbRun[] = [];
  const isWalk = (x: number, y: number) => L.cls[y]?.[x] === 'walk' || L.cls[y]?.[x] === 'nwalk';
  const isRoad = (x: number, y: number) => L.cls[y]?.[x] === 'road';
  const dirs = { S: [0, 1], N: [0, -1], E: [1, 0], W: [-1, 0] } as const;
  for (const side of ['S', 'N', 'E', 'W'] as const) {
    const [dx, dy] = dirs[side];
    const horiz = side === 'S' || side === 'N';
    const outer = horiz ? L.rows : L.cols, inner = horiz ? L.cols : L.rows;
    for (let i = 0; i < outer; i++) {
      let j = 0;
      while (j < inner) {
        const [x, y] = horiz ? [j, i] : [i, j];
        if (!(isWalk(x, y) && isRoad(x + dx, y + dy))) { j++; continue; }
        let e = j;
        while (e < inner) { const [xx, yy] = horiz ? [e, i] : [i, e]; if (!(isWalk(xx, yy) && isRoad(xx + dx, yy + dy))) break; e++; }
        const main = L.cls[y][x] === 'walk';
        const sw = main ? L.sw : L.sw2;
        const fixed = side === 'S' ? (i + 1) * T - 4 : side === 'N' ? i * T + 14 : side === 'E' ? (i + 1) * T - 7 : i * T + 7;
        const curb = side === 'S' ? (i + 1) * T : side === 'N' ? i * T : side === 'E' ? (i + 1) * T : i * T;
        out.push({ side, main, fixed, curb, a: j * T, b: e * T, region: main ? -1 : L.region[y][x], sw });
        j = e;
      }
    }
  }
  return out;
}

const footAt = (run: CurbRun, along: number, inset = 0): [number, number] => {
  const f = run.side === 'S' || run.side === 'E' ? run.fixed - inset : run.fixed + inset;
  return run.side === 'S' || run.side === 'N' ? [along, f] : [f, along];
};

/** the pedestrian lane of each sidewalk stays clear: a band between the curb furniture and the facade zone */
export function reserveWalkways(sb: SceneBuilder, runs: CurbRun[]) {
  for (const u of runs) {
    if (u.side === 'S') sb.clear(rect(u.a, u.curb - 22, u.b, u.curb - 14), 'walkway');
    else if (u.side === 'N') sb.clear(rect(u.a, u.curb + 16, u.b, u.curb + 28), 'walkway');
    else {
      const off = u.sw >= 3 ? 30 : 16;
      if (u.side === 'E') sb.clear(rect(u.curb - off - 10, u.a, u.curb - off, u.b), 'walkway');
      else sb.clear(rect(u.curb + off, u.a, u.curb + off + 10, u.b), 'walkway');
    }
  }
}

// ------------------------------------------------------------------------------------------------

export function crossingVignettes(L: Layout, sb: SceneBuilder, r: Rng) {
  const lights = variants(C + 'Traffic_Light', [1, 2, 5]);
  const isWalk = (x: number, y: number) => L.cls[y]?.[x] === 'walk' || L.cls[y]?.[x] === 'nwalk';
  for (const c of L.crossings) {
    const key = r.pick(lights);
    const flip = r.chance(0.5);
    // per end: the two candidate pole positions (either side of the zebra), first = preferred
    const ends: { opts: [number, number][]; face: Dir }[] = [];
    if (c.axis === 'h') {
      const x0 = c.at * T, x1 = (c.at + 2) * T;
      for (const [y, end] of [[c.band0 - 1, 'N'], [c.band1, 'S']] as const) {
        if (!isWalk(c.at, y)) continue;
        const fy = end === 'N' ? (y + 1) * T - 3 : y * T + 13;
        sb.clear(rect(x0 - 4, y * T, x1 + 4, (y + 1) * T + (end === 'N' ? 0 : T)), 'crossing');
        const left = (end === 'N') !== flip;
        const o: [number, number][] = [[x0 - 7, fy], [x1 + 7, fy]];
        ends.push({ opts: left ? o : [o[1], o[0]], face: end === 'N' ? 'down' : 'up' });
      }
    } else {
      const y0 = c.at * T, y1 = (c.at + 2) * T;
      for (const [x, end] of [[c.band0 - 1, 'W'], [c.band1, 'E']] as const) {
        if (!isWalk(x, c.at)) continue;
        const fx = end === 'W' ? (x + 1) * T - 7 : x * T + 7;
        sb.clear(rect(x * T - (end === 'W' ? T : 0), y0 - 4, (x + 1) * T + (end === 'E' ? T : 0), y1 + 4), 'crossing');
        const above = (end === 'W') !== flip;
        const o: [number, number][] = [[fx, y0 - 3], [fx, y1 + 12]];
        ends.push({ opts: above ? o : [o[1], o[0]], face: end === 'W' ? 'right' : 'left' });
      }
    }
    // usually a pole at one end only; sometimes both
    const both = ends.length === 2 && r.chance(0.35);
    const order = r.shuffle([...ends.keys()]);
    let placed = 0;
    for (const i of order) {
      if (placed >= (both ? 2 : 1)) break;
      for (const [fx, fy] of ends[i].opts) {
        // the pole must stand on the pavement, never in the carriageway
        if (!sb.putFoot(key, fx, fy, 'traffic_light', { group: 'crossing', ignoreClear: ['crossing', 'walkway'], walk: true })) continue;
        placed++;
        if (r.chance(0.35)) person(sb, r, fx + (r.chance(0.5) ? 14 : -14), fy + 2, 'stand', ends[i].face, 'citizen', 'crossing');
        break;
      }
    }
  }
}

// ------------------------------------------------------------------------------------------------
// curb furniture. Lamps: sparse, at street ends and every 8-12 cells, arms over the road. Trees: irregular
// spacing, not on every street, never on narrow north-side pavements (canopies would hang over the lanes).
// Low items (planters, bollards) as the alternative. Every item must stand on the pavement, off the walkway,
// away from doors, crossings, driveways.

export function curbStrips(L: Layout, sb: SceneBuilder, r: Rng, runs: CurbRun[]) {
  const LAMP_R = [C + 'Street_Lamp_1', C + 'Street_Lamp_2', C + 'Street_Lamp_3'], LAMP_L = [C + 'Street_Lamp_4'];
  const streetLamp = r.pick([...LAMP_R, C + 'Street_Lamp_5']);
  void L;
  for (const run of runs) {
    const len = run.b - run.a;
    if (len < 4 * T) continue;
    const rr = r.fork(`curb${run.side}${run.fixed}${run.a}`);
    const horiz = run.side === 'S' || run.side === 'N';
    const put = (key: string, along: number, cls: string, inset = 0) => {
      const [fx, fy] = footAt(run, along, inset);
      return sb.putFoot(key, fx, fy, cls, { group: 'curb', walk: true, pad: 3 });
    };
    // ---- lamps ----
    if (rr.chance(run.main ? 0.7 : 0.35)) {
      const lamp = run.side === 'W' ? rr.pick(LAMP_L) : run.side === 'E' ? rr.pick(LAMP_R) : streetLamp;
      const step = rr.int(8, 12) * T;
      for (let s = run.a + rr.int(20, 40); s < run.b - 16; s += step + rr.int(-1, 1) * T) put(lamp, s + rr.jitter(2), 'street_lamp');
    }
    // ---- trees or low furniture ----
    const treeOk = run.side === 'S' || run.sw >= 3;
    const what = rr.weighted([
      ['trees', treeOk ? (run.main ? 3 : 1.2) : 0], ['planters', horiz && run.main ? 1 : 0], ['bollards', run.main ? 1 : 0.6], ['none', run.main ? 1.2 : 2.5],
    ] as const);
    if (what === 'trees') {
      const tree = rr.pick([C + 'Tree_11', C + 'Tree_13', C + 'Tree_13']);
      const inset = horiz ? (run.side === 'N' ? 8 : 0) : 8;
      // irregular: gaps of 3-7 cells, sometimes a missing tree
      for (let s = run.a + rr.int(24, 56); s < run.b - 20;) {
        if (!rr.chance(0.15)) put(tree, s + rr.jitter(3), 'tree', inset);
        s += rr.weighted([[3, 1], [4, 3], [5, 3], [6, 2], [7, 1]] as const) * T + rr.int(-4, 4);
      }
    } else if (what === 'planters' || what === 'bollards') {
      const planter = rr.pick(variants(C + 'Flower_Bush', [1, 2, 3]));
      const bollard = rr.pick([C + 'Pole_1', ...variants(C + 'Pedestrian_Barrier_Post', [1, 2, 3, 6, 7])]);
      // a short group of them near one end of the run (corners are where people cut across)
      const groupAt = rr.chance(0.5) ? run.a + rr.int(24, 48) : run.b - rr.int(48, 96);
      const n = rr.int(3, 6);
      for (let k = 0; k < n; k++) put(what === 'planters' && k % 2 === 0 ? planter : bollard, groupAt + k * (what === 'planters' ? 24 : 20), what === 'planters' ? 'plant' : 'bollard');
    }
    // ---- a bin near a corner, a hydrant at the curb ----
    if (rr.chance(run.main ? 0.6 : 0.3)) put(rr.pick(variants(C + 'Trashbin')), rr.chance(0.5) ? run.a + rr.int(18, 40) : run.b - rr.int(18, 40), 'trash');
    if (run.main && len > 8 * T && rr.chance(0.45)) put(rr.pick(variants(C + 'Hydrant')), rr.chance(0.5) ? run.a + rr.int(40, 80) : run.b - rr.int(40, 80), 'hydrant');
  }
}

// ------------------------------------------------------------------------------------------------
// shop fronts: things hug the facade beside the door (never in front of it, never in the walkway)

const signs = () => [...variants(C + 'Info_Sign'), ...variants('9_Shopping_Center_and_Markets/Sign').filter(hasSprite)];

export function frontVignettes(L: Layout, plan: BlockPlan, sb: SceneBuilder, r: Rng) {
  for (const pb of plan.buildings) {
    const rr = r.fork(pb.plan.id);
    const { plan: b, cx, cy } = pb;
    const x0 = cx * T, bottom = (cy + b.h) * T;
    const g = b.id;
    // how deep is the free strip in front of the facade (cells, until road / building)
    let depth = 0;
    for (let y = cy + b.h; y < L.rows && (L.cls[y][cx + 1] === 'walk' || L.cls[y][cx + 1] === 'lot') && depth < 6; y++) depth++;
    const door = b.doors[0] ?? b.w * T / 2;
    const dx = x0 + door;
    const side = rr.chance(0.5) ? 1 : -1;
    const base = bottom + 10;          // foot line hugging the facade
    const put = (key: string, fx: number, fy: number, cls: string) => sb.putFoot(key, fx, fy, cls, { group: g, depth: 9 });
    switch (b.front) {
      case 'cafe': case 'bakery': {
        if (b.front === 'cafe' && b.label.startsWith('Ice_Cream') && hasSprite('5_Floor_Modular_Building/Ground_Floor_Ice_Cream_Shop_Props_3'))
          put('5_Floor_Modular_Building/Ground_Floor_Ice_Cream_Shop_Props_3', dx + (door > 56 ? -48 : 44), base + 12, 'table');
        // tables only where the pavement leaves room for them (the walkway check rejects the rest)
        const table = rr.pick(variants(V + 'Street_Food_Table'));
        for (let i = 0; i < rr.int(1, 3); i++) {
          const tx = x0 + 12 + rr.int(0, 6) + i * 34;
          if (Math.abs(tx - dx) < 22) continue;
          const ty = bottom + 20;
          if (!sb.putFoot(table, tx, ty, 'table', { group: g })) continue;
          for (const [sx, dir] of [[-12, 'right'], [12, 'left']] as const) {
            if (rr.chance(0.55)) { if (!person(sb, rr, tx + sx, ty - 1, 'sit', dir, 'customer', g)) sb.putFoot(V + 'Street_Food_Chair_1', tx + sx, ty - 2, 'chair', { group: g }); }
            else sb.putFoot(V + 'Street_Food_Chair_1', tx + sx, ty - 2, 'chair', { group: g });
          }
        }
        put(rr.pick(signs()), dx + side * 22, base, 'info_sign');
        if (rr.chance(0.6)) person(sb, rr, dx + side * rr.int(10, 30), base + rr.int(6, 12), 'stand', 'up', 'customer', g);
        break;
      }
      case 'retail': case 'hardware': case 'market': {
        const shrub = rr.pick([C + 'Shrub_3', C + 'Shrub_4', ...variants(C + 'Pot')]);
        if (rr.chance(0.7)) { put(shrub, dx - 22, base, 'plant'); put(shrub, dx + 22, base, 'plant'); }
        if (rr.chance(0.55)) put(rr.pick(signs()), dx + side * 34, base, 'info_sign');
        if (rr.chance(0.5)) put(rr.pick(variants(C + 'Trashbin')), dx - side * rr.int(38, 52), base, 'trash');
        const n = b.front === 'market' ? rr.int(1, 3) : rr.int(0, 2);
        for (let i = 0; i < n; i++) person(sb, rr, dx + rr.int(-40, 40), base + rr.int(6, 14), rr.chance(0.7) ? 'stand' : 'phone', rr.pick(['up', 'up', 'left', 'right'] as const), 'customer', g);
        break;
      }
      case 'condo': case 'house': {
        const fl = rr.pick(variants(C + 'Flower_Bush'));
        if (rr.chance(0.6)) { put(fl, dx - 32, base, 'plant'); if (rr.chance(0.6)) put(fl, dx + 32, base, 'plant'); }
        if (rr.chance(0.35)) put(C + 'Mailbox_1', dx + side * 20, base, 'utility');
        if (rr.chance(0.25)) put(rr.pick(variants(C + 'Trashbin')), dx - side * rr.int(40, 60), base, 'trash');
        if (rr.chance(0.35)) person(sb, rr, dx + rr.int(-20, 20), base + rr.int(4, 12), rr.chance(0.5) ? 'stand' : 'phone', rr.pick(['down', 'left', 'right'] as const), 'resident', g);
        break;
      }
      case 'gym': {
        if (rr.chance(0.7)) person(sb, rr, dx + side * 16, base + 8, 'stand', 'down', 'citizen', g);
        put(rr.pick(variants(C + 'Trashbin')), dx + side * 40, base, 'trash');
        break;
      }
      case 'closed': {
        if (rr.chance(0.6)) for (let i = 0; i < rr.int(1, 3); i++) put(rr.pick(variants(C + 'Trash')), dx + side * rr.int(20, 44), base, 'trash');
        if (rr.chance(0.3)) put(rr.pick(variants(C + 'Cardboard_Trash')), dx - side * rr.int(20, 36), base, 'trash');
        break;
      }
    }
  }
}

// ------------------------------------------------------------------------------------------------
// alleys, plaza, pockets

export function zoneVignettes(L: Layout, plan: BlockPlan, sb: SceneBuilder, r: Rng) {
  for (const z of plan.zones) {
    const rr = r.fork(`zone${z.x0},${z.y0}`);
    const w = (z.x1 - z.x0) * T, x0 = z.x0 * T, y0 = z.y0 * T, y1 = z.y1 * T;
    if (z.kind === 'alley') {
      // the way through stays clear; bins stand against the wall at the far (inner) end
      sb.clear(rect(x0 + (w >= 32 ? 18 : 2), y0 + 2 * T, x0 + w - 2, y1 + L.sw * T), 'alley');
      const n = rr.int(1, 2);
      for (let i = 0; i < n; i++) {
        const key = w >= 32 ? rr.pick(variants(C + 'Dumpster').filter(k => spr(k).w <= 32)) : rr.pick(variants(C + 'Trashbin'));
        sb.putFoot(key, x0 + (w >= 32 ? 16 : w / 2), y0 + 26 + i * 22, 'trash', { group: 'alley', ignoreClear: true });
      }
      for (let i = 0; i < rr.int(0, 2); i++) sb.putFoot(rr.pick(variants(C + 'Trash')), x0 + (w >= 32 ? rr.int(4, 14) : rr.int(4, w - 4)), y0 + rr.int(30, 44), 'trash', { group: 'alley', ignoreClear: true });
      if (rr.chance(0.3)) sb.putFoot(rr.pick(variants(C + 'Hanging_Clothes')), x0 + w / 2, y0 + rr.int(3, 5) * T, 'utility', { group: 'alley', ignoreClear: true, occupy: false });
      if (rr.chance(0.25)) person(sb, rr, x0 + w / 2, y1 - rr.int(40, 80), 'phone', 'down', 'citizen', 'alley');
    } else if (z.kind === 'plaza') {
      const paving = rr.pick(['sidewalk_beige', 'sidewalk_lightbeige', 'sidewalk_brown'].filter(st => st !== L.mainStyle));
      for (let y = z.y0; y < z.y1; y++) for (let x = z.x0; x < z.x1; x++) L.base[y][x] = slab(paving, x, y);
      // centre piece a little above the middle so there is room in front of it
      const cxp = x0 + w / 2, cyp = y0 + (y1 - y0) * 0.45;
      const centre = rr.weighted([['fountain', 2], ['tree', 2], ['kiosk', 1]] as const);
      let half = 16;
      if (centre === 'fountain') { const k = rr.pick(variants(C + 'Fountain')); half = (spr(k).bb[2] - spr(k).bb[0]) / 2; sb.putFoot(k, cxp, cyp + 12, 'utility', { group: 'plaza' }); }
      if (centre === 'tree') sb.putFoot(rr.pick([C + 'Tree_11', C + 'Tree_13']), cxp, cyp + 14, 'tree', { group: 'plaza' });
      if (centre === 'kiosk') { const k = rr.pick([C + 'Kiosk_Infopoint_1', C + 'Kiosk_Coffee_Cup', C + 'Kiosk_Icecream'].filter(hasSprite)); half = (spr(k).bb[2] - spr(k).bb[0]) / 2; sb.putFoot(k, cxp, cyp + 20, 'kiosk', { group: 'plaza' }); }
      // benches either side facing the centre with a cell of space between; on a narrow plaza one bench south of
      // the centre piece, facing it (back to the viewer)
      const off = Math.round(half + T + 8);
      if (rr.chance(0.85)) {
        const l = sb.putFoot(rr.pick([C + 'Bench_4', C + 'Bench_6']), cxp - off, cyp + 30, 'bench', { group: 'plaza' });
        const rgt = l && sb.putFoot(rr.pick([C + 'Bench_3', C + 'Bench_5']), cxp + off, cyp + 30, 'bench', { group: 'plaza' });
        if (l && !rgt) { sb.objects.splice(sb.objects.indexOf(l), 1); sb.feet.pop(); }
        if (l && rgt) { if (rr.chance(0.6)) { const s = rr.chance(0.5) ? -1 : 1; person(sb, rr, cxp + s * off + (s < 0 ? 1 : -1), cyp + 18, 'sit', s < 0 ? 'right' : 'left', 'citizen', 'plaza'); } }
        else sb.putFoot(C + 'Bench_7', cxp, y1 - 3, 'bench', { group: 'plaza' });
      }
      if (rr.chance(0.5)) for (const s of [-1, 1]) sb.putFoot(rr.pick(variants(C + 'Street_Lamp', [5])), cxp + s * (off + 20), cyp + 30, 'street_lamp', { group: 'plaza' });
      const nP = rr.int(1, 3);
      for (let i = 0, k = 0; i < 10 && k < nP; i++) if (person(sb, rr, cxp + rr.int(-w / 2 + 10, w / 2 - 10), rr.int(y0 + 18, y1 - 2), rr.pick(['stand', 'phone', 'walk'] as const), rr.pick(['down', 'left', 'right', 'up'] as const), 'citizen', 'plaza', rr.chance(0.2))) k++;
    } else if (z.kind === 'pocket') {
      const what = rr.weighted([['tree', 3], ['bench', 2], ['phone', 1], ['bins', 1]] as const);
      const cxp = x0 + w / 2, fy = y1 - 6;
      if (what === 'tree') sb.putFoot(rr.pick([C + 'Tree_1', C + 'Tree_8', C + 'Tree_13']), cxp, fy, 'tree', { group: 'pocket' });
      if (what === 'bench') sb.putFoot(C + 'Bench_1', cxp, fy, 'bench', { group: 'pocket' });
      if (what === 'phone') sb.putFoot(rr.pick(variants(C + 'Phone_Booth')), cxp, fy, 'utility', { group: 'pocket' });
      if (what === 'bins') for (let i = 0; i < 2; i++) sb.putFoot(rr.pick(variants(C + 'Trashbin')), cxp - 8 + i * 16, fy, 'trash', { group: 'pocket' });
    }
  }
}

/** neighbour regions too small for buildings (notch islands): a little public square */
export function islandSquares(L: Layout, neigh: BlockPlan, sb: SceneBuilder, r: Rng) {
  const cells = new Map<number, [number, number][]>();
  for (let y = 0; y < L.rows; y++) for (let x = 0; x < L.cols; x++) {
    const g = L.region[y][x];
    if (g >= 0) cells.set(g, [...(cells.get(g) ?? []), [x, y]]);
  }
  const hasBuilding = new Set<number>();
  for (const b of neigh.buildings) for (let y = b.cy; y < b.cy + b.plan.h; y++) for (let x = b.cx; x < b.cx + b.plan.w; x++) {
    const g = L.region[y]?.[x]; if (g !== undefined && g >= 0) hasBuilding.add(g);
  }
  for (const [g, cs] of cells) {
    if (hasBuilding.has(g) || cs.length > 260) continue;
    const xs = cs.map(c => c[0]), ys = cs.map(c => c[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs) + 1, y0 = Math.min(...ys), y1 = Math.max(...ys) + 1;
    if (x0 === 0 || y0 === 0 || x1 === L.cols || y1 === L.rows) continue;   // only fully visible islands
    const rr = r.fork(`island${g}`);
    const cx = (x0 + x1) / 2 * T, cy = (y0 + y1) / 2 * T;
    const paving = rr.pick(['sidewalk_beige', 'sidewalk_brown', 'sidewalk_lightbeige']);
    for (const [x, y] of cs) if (L.cls[y][x] === 'nlot') L.base[y][x] = slab(paving, x, y);
    const centre = rr.weighted([['kiosk', 2], ['fountain', 1], ['billboard', 1], ['tree', 1]] as const);
    if (centre === 'kiosk') sb.putFoot(rr.pick([C + 'Kiosk_Infopoint_1', C + 'Kiosk_Coffee_Cup', C + 'Kiosk_Icecream', C + 'Kiosk_Mushroom'].filter(hasSprite)), cx, cy + 22, 'kiosk', { group: 'island', ignoreClear: true });
    if (centre === 'fountain') sb.putFoot(rr.pick(variants(C + 'Fountain')), cx, cy + 14, 'utility', { group: 'island', ignoreClear: true });
    if (centre === 'billboard') sb.putFoot(rr.pick(variants(C + 'Billboard', [2, 3, 5, 6, 7, 8])), cx, cy + 30, 'info_sign', { group: 'island', ignoreClear: true });
    if (centre === 'tree') sb.putFoot(C + 'Tree_13', cx, cy + 16, 'tree', { group: 'island', ignoreClear: ['walkway'] });
    for (const sx of [-1, 1]) if (rr.chance(0.7)) sb.putFoot(rr.pick([C + 'Tree_11', C + 'Tree_13']), cx + sx * ((x1 - x0) / 2 - 1.5) * T, cy + rr.int(-8, 16), 'tree', { group: 'island', ignoreClear: ['walkway'] });
    if (rr.chance(0.7)) sb.putFoot(C + 'Bench_2', cx + rr.int(-20, 20), y1 * T - 10, 'bench', { group: 'island', ignoreClear: ['walkway'] });
    for (let i = 0; i < rr.int(1, 3); i++) {
      const p = makePerson(rr, 'citizen');
      sb.putChar(p.layers, frameFor(p, rr.pick(['stand', 'phone', 'walk'] as const), rr.pick(['down', 'left', 'right', 'up'] as const), rr), cx + rr.int(-30, 30), cy + rr.int(-10, 30), 'citizen', { group: 'island' });
    }
  }
}

// ------------------------------------------------------------------------------------------------
// bus stop, parked & driving cars, road details

export function busStop(L: Layout, sb: SceneBuilder, r: Rng, runs: CurbRun[]) {
  const cand = runs.filter(u => u.main && u.side === 'S' && u.b - u.a >= 8 * T);
  if (!cand.length || !r.chance(0.75)) return;
  // a spot where the whole stop (bin .. shelter .. sign) is clear of doors, crossings, alleys and driveways
  let run = cand[0], s = -1;
  for (let t = 0; t < 24 && s < 0; t++) {
    const u = r.pick(cand), p = r.int(u.a + 4 * T, u.b - 5 * T);
    if (sb.free(rect(p - 60, u.fixed - 30, p + 64, u.fixed + 2), { ignoreClear: ['walkway'] })) { run = u; s = p; }
  }
  if (s < 0) return;
  const fy = run.fixed + 1;
  const shelterKey = r.pick([V + 'Bus_Stop_1', V + 'Bus_Stop_2']);
  const sh = sb.putFoot(shelterKey, s, fy - 2, 'bus_stop', { group: 'bus', ignoreClear: ['walkway'] });
  if (!sh) return;
  sb.putFoot(r.pick(variants(V + 'Bus_Stop_Sign')), s + 52, fy, 'bus_stop', { group: 'bus', ignoreClear: ['walkway'] });
  sb.clear(rect(s - 56, fy - 30, s + 64, fy + 6), 'bus stop');
  if (r.chance(0.8)) person(sb, r, s - 14 + r.int(0, 20), fy - 10, 'sit', r.pick(['left', 'right'] as const), 'waiting', 'bus');
  for (let i = 0; i < r.int(0, 2); i++) person(sb, r, s + r.int(-50, 70), fy - r.int(2, 8), r.chance(0.5) ? 'stand' : 'phone', 'down', 'waiting', 'bus');
  sb.putFoot(r.pick(variants(C + 'Trashbin')), s - 52, fy - 4, 'trash', { group: 'bus', ignoreClear: ['bus stop', 'walkway'] });
}

const carKeys = (dir: string, wide: boolean) => variants(V + `Car_${dir}`).filter(k => wide ? spr(k).w >= 64 : spr(k).h >= 64);

export function cars(L: Layout, sb: SceneBuilder, r: Rng, runs: CurbRun[]) {
  // parked: in the lane next to the curb, facing the lane's traffic direction (right-hand traffic)
  for (const run of runs) {
    const rr = r.fork(`cars${run.side}${run.fixed}${run.a}`);
    if (!rr.chance(run.main ? 0.55 : 0.35) || run.b - run.a < 8 * T) continue;
    const horiz = run.side === 'S' || run.side === 'N';
    const n = rr.int(1, 3);
    let s = run.a + rr.int(2 * T, Math.max(2 * T, (run.b - run.a) / 3));
    for (let i = 0; i < n && s < run.b - 5 * T; i++) {
      if (horiz) {
        const dir = run.side === 'S' ? 'Right' : 'Left';
        const key = rr.pick(carKeys(dir, true));
        const fy = run.side === 'S' ? run.curb + 30 : run.curb - 3;     // car body in the lane next to the curb
        const p = sb.putFoot(key, s + 32, fy, 'vehicle', { group: 'parking', depth: 22 });
        if (p && rr.chance(0.35)) sb.putFoot(C + 'Parking_Meter_1', s + 8, run.side === 'S' ? run.curb - 3 : run.curb + 14, 'utility', { group: 'parking' });
        s += 80 + rr.int(0, 3) * 16;
      } else {
        const dir = run.side === 'E' ? 'Down' : 'Up';
        const key = rr.pick(carKeys(dir, false));
        const fx = run.side === 'E' ? run.curb + 16 : run.curb - 16;
        sb.putFoot(key, fx, s + 60, 'vehicle', { group: 'parking', depth: 50 });
        s += 80 + rr.int(0, 3) * 16;
      }
    }
  }
  // a couple of driving cars in random corridor lanes
  for (let i = 0; i < r.int(0, 2); i++) {
    const sg = r.pick(L.segs);
    if (!sg || sg.b - sg.a < 8) continue;
    const p = r.int(sg.a + 1, sg.b - 5) * T;
    const half = (sg.band1 - sg.band0) / 2;
    if (sg.axis === 'h') {
      const east = r.chance(0.5);
      const lane = east ? sg.band0 + half + 1 : sg.band0 + half - 1;
      sb.putFoot(r.pick(carKeys(east ? 'Right' : 'Left', true)), p, lane * T + (east ? 14 : 4), 'vehicle', { group: 'traffic', depth: 22 });
    } else {
      const south = r.chance(0.5);
      const lane = south ? sg.band0 + half - 1 : sg.band0 + half + 1;
      sb.putFoot(r.pick(carKeys(south ? 'Down' : 'Up', false)), lane * T + 2, p, 'vehicle', { group: 'traffic', depth: 50 });
    }
  }
}

export function roadDetails(L: Layout, sb: SceneBuilder, r: Rng) {
  const manholes = variants(C + 'Manhole', [1, 2, 3, 4, 5]);
  for (const sg of L.segs) {
    if (sg.b - sg.a < 10 || !r.chance(0.4)) continue;
    // one manhole, centred in a lane (lanes are either side of the centre line)
    const half = Math.floor((sg.band1 - sg.band0) / 2);
    const lane = sg.band0 + (r.chance(0.5) ? Math.max(1, half - 1) : Math.min(sg.band1 - sg.band0 - 2, half + 1));
    const p = r.int(sg.a + 3, sg.b - 4) * T + 8, q = lane * T + 12;
    const [fx, fy] = sg.axis === 'h' ? [p, q] : [q - 4, p];
    sb.putFoot(r.pick(manholes), fx, fy, 'manhole', { group: 'road', depth: 4 });
  }
  // road works (rare): hole + barriers + cones in a lane
  if (r.chance(0.25)) {
    const sg = r.pick(L.segs.filter(s => s.b - s.a >= 10));
    if (sg) {
      const p = r.int(sg.a + 2, sg.b - 4) * T;
      const q = (sg.band0 + 1) * T + 8;
      const [fx, fy] = sg.axis === 'h' ? [p, q + 10] : [q, p];
      if (!sb.putFoot(r.pick(variants(C + 'Holes').filter(k => spr(k).w >= 32)), fx, fy, 'roadworks', { group: 'works', depth: 6, pad: 20 })) return;
      const cones = variants(C + 'Cone');
      for (const [ox, oy] of [[-24, -12], [24, -12], [-26, 10], [26, 10]]) if (r.chance(0.75)) sb.putFoot(r.pick(cones), fx + ox, fy + oy, 'roadworks', { group: 'works' });
      if (r.chance(0.7)) sb.putFoot(r.pick(variants(C + 'Traffic_Barrier')), fx, fy - 22, 'roadworks', { group: 'works' });
      if (r.chance(0.4)) person(sb, r, fx + 30, fy + 2, 'stand', 'left', 'worker', 'works');
    }
  }
}

export function walkers(L: Layout, sb: SceneBuilder, r: Rng, runs: CurbRun[]) {
  // a few pedestrians on the sidewalks, between the facade and the curb strip
  for (const run of runs) {
    if (!r.chance(run.main ? 0.75 : 0.4)) continue;
    const n = Math.max(0, Math.round((run.b - run.a) / (run.main ? 150 : 300)) + r.int(-1, 1));
    for (let i = 0; i < n; i++) {
      const s = r.int(run.a + 8, run.b - 8);
      const horiz = run.side === 'S' || run.side === 'N';
      const off = run.side === 'S' ? -14 : run.side === 'N' ? 14 : run.side === 'E' ? -12 : 12;
      const [fx, fy] = horiz ? [s, run.fixed + off] : [run.fixed + off, s];
      const dir: Dir = horiz ? r.pick(['left', 'right'] as const) : r.pick(['up', 'down'] as const);
      person(sb, r, fx, fy, r.weighted([['walk', 5], ['phone', 1], ['stand', 1]] as const), dir, 'citizen', 'walker', r.chance(0.08));
    }
  }
}

export { type PlacedBuilding };
