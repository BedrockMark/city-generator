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

function person(sb: SceneBuilder, r: Rng, fx: number, fy: number, pose: Pose, dir: Dir, role = 'citizen', group?: string, kid = false) {
  const p = makePerson(r, role, { kid });
  return sb.putChar(p.layers, frameFor(p, pose, dir, r), fx, fy, role, { group });
}

// ------------------------------------------------------------------------------------------------
// curb runs: straight sequences of sidewalk cells that touch the road on one side

export interface CurbRun { side: 'S' | 'N' | 'E' | 'W'; main: boolean; fixed: number; curb: number; a: number; b: number; region: number }
// side = where the ROAD is relative to the sidewalk. fixed = furniture foot line (px); curb = px of the curb line; a..b = px range along

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
        const deep = side === 'N' && (L.cls[i + 1]?.[x] === 'walk' || L.cls[i + 1]?.[x] === 'nwalk');
        const fixed = side === 'S' ? (i + 1) * T - 4 : side === 'N' ? (deep ? (i + 1) * T + 10 : i * T + 14) : side === 'E' ? (i + 1) * T - 7 : i * T + 7;
        const curb = side === 'S' ? (i + 1) * T : side === 'N' ? i * T : side === 'E' ? (i + 1) * T : i * T;
        out.push({ side, main, fixed, curb, a: j * T, b: e * T, region: main ? -1 : L.region[y][x] });
        j = e;
      }
    }
  }
  return out;
}

const footAt = (run: CurbRun, along: number): [number, number] =>
  run.side === 'S' || run.side === 'N' ? [along, run.fixed] : [run.fixed, along];

// ------------------------------------------------------------------------------------------------

export function crossingVignettes(L: Layout, sb: SceneBuilder, r: Rng) {
  const lights = variants(C + 'Traffic_Light', [1, 2, 5]);
  for (const c of L.crossings) {
    const key = r.pick(lights);
    const flip = r.chance(0.5);
    const ends: [number, number, boolean][] = [];   // [fx, fy, isWalk]
    if (c.axis === 'h') {
      const x0 = c.at * T, x1 = (c.at + 2) * T;
      for (const [y, end] of [[c.band0 - 1, 'N'], [c.band1, 'S']] as const) {
        const walk = L.cls[y]?.[c.at] === 'walk' || L.cls[y]?.[c.at] === 'nwalk';
        if (!walk) continue;
        const fy = end === 'N' ? (y + 1) * T - 3 : y * T + 13;
        sb.clear(rect(x0 - 4, y * T, x1 + 4, (y + 1) * T + (end === 'N' ? 0 : T)), 'crossing');
        const left = (end === 'N') !== flip;
        ends.push([left ? x0 - 7 : x1 + 7, fy, true]);
      }
    } else {
      const y0 = c.at * T, y1 = (c.at + 2) * T;
      for (const [x, end] of [[c.band0 - 1, 'W'], [c.band1, 'E']] as const) {
        const walk = L.cls[c.at]?.[x] === 'walk' || L.cls[c.at]?.[x] === 'nwalk';
        if (!walk) continue;
        const fx = end === 'W' ? (x + 1) * T - 7 : x * T + 7;
        sb.clear(rect(x * T - (end === 'W' ? T : 0), y0 - 4, (x + 1) * T + (end === 'E' ? T : 0), y1 + 4), 'crossing');
        const above = (end === 'W') !== flip;
        ends.push([fx, above ? y0 - 3 : y1 + 12, true]);
      }
    }
    const oneEnd = ends.length === 2 && r.chance(0.4) ? r.int(0, 1) : -1;
    for (const [i, [fx, fy]] of ends.entries()) {
      if (oneEnd >= 0 && i !== oneEnd) continue;
      sb.putFoot(key, fx, fy, 'traffic_light', { group: 'crossing', ignoreClear: true });
      if (r.chance(0.35)) person(sb, r, fx + (r.chance(0.5) ? 14 : -14), fy + 2, 'stand', c.axis === 'h' ? (fy < c.band0 * T ? 'down' : 'up') : (fx < c.band0 * T ? 'right' : 'left'), 'citizen', 'crossing');
    }
  }
}

// ------------------------------------------------------------------------------------------------

type Motif = { items: string[]; period: number };

export function curbStrips(L: Layout, sb: SceneBuilder, r: Rng, runs: CurbRun[]) {
  for (const run of runs) {
    const len = run.b - run.a;
    if (len < 3 * T) continue;
    const rr = r.fork(`curb${run.side}${run.fixed}${run.a}`);
    const horiz = run.side === 'S' || run.side === 'N';
    const tree = rr.pick([C + 'Tree_11', C + 'Tree_13', C + 'Tree_13']);
    const lamp = rr.pick(variants(C + 'Street_Lamp'));
    const bollard = rr.pick([C + 'Pole_1', ...variants(C + 'Pedestrian_Barrier_Post', [1, 2, 3, 6, 7])]);
    const planter = rr.pick(variants(C + 'Flower_Bush'));
    const motifs: [Motif, number][] = run.main ? [
      [{ items: ['tree', 'lamp'], period: rr.int(48, 64) }, 3],
      [{ items: ['tree'], period: rr.int(96, 120) }, 2],
      [{ items: ['bollard'], period: rr.int(40, 64) }, 2],
      [{ items: horiz ? ['planter', 'bollard'] : ['bollard'], period: 24 }, horiz ? 1.5 : 0.5],
      [{ items: ['lamp', 'bollard', 'bollard'], period: rr.int(32, 40) }, 1],
    ] : [
      [{ items: ['tree', 'lamp'], period: rr.int(56, 80) }, 1.5],
      [{ items: ['lamp'], period: rr.int(96, 140) }, 3],
      [{ items: ['tree'], period: rr.int(96, 128) }, 1],
      [{ items: ['bollard'], period: rr.int(48, 80) }, 1],
      [{ items: [], period: 999 }, 1.5],          // some streets have no furniture strip at all
    ];
    const m = rr.weighted(motifs);
    if (!m.items.length) continue;
    const keyOf: Record<string, string> = { tree, lamp, bollard, planter };
    // trees need 3 cells of room in the strip; skip them on very narrow vertical runs next to buildings
    let k = 0;
    // a steady beat with small human irregularity: +-1-3 px drift, occasional substitution (bin, sign, bench)
    const subs = [rr.pick(variants(C + 'Trashbin')), rr.pick(variants(C + 'Info_Sign')), horiz ? C + 'Bench_1' : C + 'Bench_4'];
    for (let s = run.a + rr.int(10, Math.max(12, m.period / 2)); s < run.b - 8; s += m.period, k++) {
      const item = m.items[k % m.items.length];
      const [fx, fy] = footAt(run, s + rr.jitter(3));
      let key = keyOf[item];
      if (!key) continue;
      if (item !== 'tree' && rr.chance(0.12)) key = rr.pick(subs);
      sb.putFoot(key, fx, fy, item === 'planter' ? 'plant' : item, { group: 'curb' });
    }
    // occasional hydrant near a run end (refs: hydrants stand at the curb near corners)
    if (run.main && len > 8 * T && rr.chance(0.45)) {
      const s = rr.chance(0.5) ? run.a + rr.int(18, 40) : run.b - rr.int(18, 40);
      const [fx, fy] = footAt(run, s);
      sb.putFoot(rr.pick(variants(C + 'Hydrant')), fx, fy, 'hydrant', { group: 'curb' });
    }
  }
}

// ------------------------------------------------------------------------------------------------
// shop fronts

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
    const sideX = (off: number) => dx + (rr.chance(0.5) ? off : -off);
    const base = bottom + 7;          // foot line hugging the facade
    switch (b.front) {
      case 'cafe': case 'bakery': {
        if (b.front === 'cafe' && b.label.startsWith('Ice_Cream') && hasSprite('5_Floor_Modular_Building/Ground_Floor_Ice_Cream_Shop_Props_3'))
          sb.putFoot('5_Floor_Modular_Building/Ground_Floor_Ice_Cream_Shop_Props_3', dx + (door > 56 ? -48 : 44), base + 14, 'table', { group: g });
        const nSets = depth >= 2 ? rr.int(1, 3) : 0;
        const table = rr.pick(variants(V + 'Street_Food_Table'));
        for (let i = 0; i < nSets; i++) {
          const tx = x0 + 12 + rr.int(0, 6) + i * 34;
          if (Math.abs(tx - dx) < 20) continue;
          const ty = bottom + 20;
          if (!sb.putFoot(table, tx, ty, 'table', { group: g })) continue;
          for (const [sx, dir] of [[-12, 'right'], [12, 'left']] as const) {
            if (rr.chance(0.55)) { if (!person(sb, rr, tx + sx, ty - 1, 'sit', dir, 'customer', g)) sb.putFoot(V + 'Street_Food_Chair_1', tx + sx, ty - 2, 'chair', { group: g }); }
            else sb.putFoot(V + 'Street_Food_Chair_1', tx + sx, ty - 2, 'chair', { group: g });
          }
        }
        sb.putFoot(rr.pick(signs()), sideX(22), base + 6, 'info_sign', { group: g });
        if (rr.chance(0.6)) person(sb, rr, sideX(rr.int(10, 30)), base + rr.int(10, 18), 'stand', 'up', 'customer', g);
        break;
      }
      case 'retail': case 'hardware': case 'market': {
        const shrub = rr.pick([C + 'Shrub_3', C + 'Shrub_4', ...variants(C + 'Pot')]);
        if (rr.chance(0.7)) { sb.putFoot(shrub, dx - 20, base, 'plant', { group: g }); sb.putFoot(shrub, dx + 20, base, 'plant', { group: g }); }
        if (rr.chance(0.55)) sb.putFoot(rr.pick(signs()), sideX(30), base + 8, 'info_sign', { group: g });
        if (rr.chance(0.5)) sb.putFoot(rr.pick(variants(C + 'Trashbin')), sideX(rr.int(36, 52)), base + 2, 'trash', { group: g });
        const n = b.front === 'market' ? rr.int(1, 3) : rr.int(0, 2);
        for (let i = 0; i < n; i++) person(sb, rr, dx + rr.int(-40, 40), base + rr.int(10, 20), rr.chance(0.7) ? 'stand' : 'phone', rr.pick(['up', 'up', 'left', 'right'] as const), 'customer', g);
        break;
      }
      case 'condo': case 'house': {
        const fl = rr.pick(variants(C + 'Flower_Bush'));
        if (rr.chance(0.6)) { sb.putFoot(fl, dx - 30, base, 'plant', { group: g }); if (rr.chance(0.6)) sb.putFoot(fl, dx + 30, base, 'plant', { group: g }); }
        if (rr.chance(0.35)) sb.putFoot(C + 'Mailbox_1', sideX(20), base + 2, 'utility', { group: g });
        if (rr.chance(0.25)) sb.putFoot(rr.pick(variants(C + 'Trashbin')), sideX(rr.int(40, 60)), base + 2, 'trash', { group: g });
        if (rr.chance(0.35)) person(sb, rr, dx + rr.int(-20, 20), base + rr.int(8, 16), rr.chance(0.5) ? 'stand' : 'phone', rr.pick(['down', 'left', 'right'] as const), 'resident', g);
        break;
      }
      case 'gym': {
        if (rr.chance(0.7)) person(sb, rr, sideX(16), base + 12, 'stand', 'down', 'citizen', g);
        sb.putFoot(rr.pick(variants(C + 'Trashbin')), sideX(40), base + 2, 'trash', { group: g });
        break;
      }
      case 'closed': {
        if (rr.chance(0.6)) for (let i = 0; i < rr.int(1, 3); i++) sb.putFoot(rr.pick(variants(C + 'Trash')), dx + rr.int(-40, 40), base + rr.int(0, 6), 'trash', { group: g });
        if (rr.chance(0.3)) sb.putFoot(rr.pick(variants(C + 'Cardboard_Trash')), dx + rr.int(-30, 30), base + 4, 'trash', { group: g });
        break;
      }
    }
  }
}

// ------------------------------------------------------------------------------------------------
// alleys, plaza, pockets, courtyard

export function zoneVignettes(L: Layout, plan: BlockPlan, sb: SceneBuilder, r: Rng) {
  for (const z of plan.zones) {
    const rr = r.fork(`zone${z.x0},${z.y0}`);
    const w = (z.x1 - z.x0) * T, x0 = z.x0 * T, y1 = z.y1 * T;
    if (z.kind === 'alley') {
      // bins and bags just inside the alley mouth, sometimes a laundry line higher up
      sb.clear(rect(x0, y1, x0 + w, y1 + L.sw * T), 'alley');
      const n = rr.int(1, 3);
      for (let i = 0; i < n; i++) {
        const key = w >= 32 ? rr.pick(variants(C + 'Dumpster')) : rr.pick(variants(C + 'Trashbin'));
        sb.putFoot(key, x0 + w / 2 + rr.jitter(2), y1 - 20 - i * 30, 'trash', { group: 'alley' });
      }
      for (let i = 0; i < rr.int(0, 3); i++) sb.putFoot(rr.pick(variants(C + 'Trash')), x0 + rr.int(4, w - 4), y1 - rr.int(6, 60), 'trash', { group: 'alley' });
      if (rr.chance(0.25)) person(sb, rr, x0 + w / 2, y1 - rr.int(40, 80), 'phone', 'down', 'citizen', 'alley');
    } else if (z.kind === 'plaza') {
      for (let y = z.y0; y < z.y1; y++) for (let x = z.x0; x < z.x1; x++) L.base[y][x] = slab(rr.pick(['sidewalk_beige', 'sidewalk_lightbeige', 'sidewalk_brown']), x, y);
      const cxp = x0 + w / 2, cyp = (z.y0 + z.y1) / 2 * T;
      const centre = rr.weighted([['fountain', 2], ['tree', 2], ['kiosk', 1]] as const);
      if (centre === 'fountain') sb.putFoot(rr.pick(variants(C + 'Fountain')), cxp, cyp + 12, 'utility', { group: 'plaza' });
      if (centre === 'tree') sb.putFoot(rr.pick([C + 'Tree_11', C + 'Tree_13']), cxp, cyp + 14, 'tree', { group: 'plaza' });
      if (centre === 'kiosk') sb.putFoot(rr.pick([C + 'Kiosk_Infopoint_1', C + 'Kiosk_Coffee_Cup', C + 'Kiosk_Icecream'].filter(hasSprite)), cxp, cyp + 20, 'kiosk', { group: 'plaza' });
      // symmetric benches / lamps around the centre (local symmetry)
      const bench = rr.pick([C + 'Bench_1', C + 'Bench_2', C + 'Bench_3'].filter(hasSprite));
      const off = Math.max(28, w / 2 - 18);
      for (const s of [-1, 1]) {
        if (rr.chance(0.8)) sb.putFoot(bench, cxp + s * off, cyp + 26, 'bench', { group: 'plaza' });
        if (rr.chance(0.5)) sb.putFoot(rr.pick(variants(C + 'Street_Lamp')), cxp + s * (off + 14), cyp - 6, 'street_lamp', { group: 'plaza' });
      }
      for (let i = 0; i < rr.int(1, 3); i++) person(sb, rr, cxp + rr.int(-w / 2 + 10, w / 2 - 10), cyp + rr.int(-10, 20), rr.pick(['stand', 'phone', 'walk'] as const), rr.pick(['down', 'left', 'right', 'up'] as const), 'citizen', 'plaza', rr.chance(0.2));
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

export function yardVignettes(L: Layout, plan: BlockPlan, sb: SceneBuilder, r: Rng) {
  // connected components of yard cells
  const seen = new Set<string>();
  const comps: [number, number][][] = [];
  for (let y = 0; y < L.rows; y++) for (let x = 0; x < L.cols; x++) {
    if (!plan.yard[y][x] || seen.has(`${x},${y}`)) continue;
    const st: [number, number][] = [[x, y]]; const comp: [number, number][] = []; seen.add(`${x},${y}`);
    while (st.length) { const [cx, cy] = st.pop()!; comp.push([cx, cy]);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = `${cx + dx},${cy + dy}`;
        if (plan.yard[cy + dy]?.[cx + dx] && !seen.has(k)) { seen.add(k); st.push([cx + dx, cy + dy]); } } }
    comps.push(comp);
  }
  const yardStyle = r.pick(['sidewalk_brown', 'sidewalk_grey', 'sidewalk_beige', 'sidewalk_lightgrey'].filter(s => s !== L.mainStyle));
  const isYard = (x: number, y: number) => plan.yard[y]?.[x] === true;
  let parkingUsed = false;
  for (const comp of comps.sort((p, q) => q.length - p.length)) {
    const rr = r.fork(`yard${comp[0]}`);
    for (const [x, y] of comp) L.base[y][x] = slab(yardStyle, x, y);
    if (comp.length < 6) continue;
    const rectIn = bestRect(comp, isYard);
    const touchesStreet = comp.some(([x, y]) => [[0, -1], [1, 0], [-1, 0]].some(([dx, dy]) => L.cls[y + dy]?.[x + dx] === 'walk'));
    // feature by size: deep -> perpendicular parking, shallow & long -> horizontal parking pockets, else garden;
    // service clutter (bins, laundry, crates) is an accessory in the leftover corner, never the whole yard
    const kind = !rectIn || rectIn.w < 4 || rectIn.h < 3 ? 'service'
      : rectIn.w >= 9 && rectIn.h >= 7 && touchesStreet && !parkingUsed && rr.chance(0.6) ? 'parking'
      : rectIn.w >= 10 && rectIn.h >= 4 && touchesStreet && !parkingUsed && rr.chance(0.4) ? 'pockets'
      : 'garden';
    if (kind === 'parking' && rectIn) { parkingUsed = true; parkingLot(L, sb, rr, rectIn); serviceCorner(L, sb, rr, comp, rectIn); continue; }
    if (kind === 'pockets' && rectIn) { parkingUsed = true; parkingPockets(L, sb, rr, rectIn); serviceCorner(L, sb, rr, comp, rectIn); continue; }
    if (kind === 'garden' && rectIn) { garden(L, sb, rr, rectIn); fenceStreetEdges(L, sb, rr, rectIn); serviceCorner(L, sb, rr, comp, rectIn); continue; }
    serviceCorner(L, sb, rr, comp, null);
  }
}

type CellRect = { x: number; y: number; w: number; h: number };

/** largest axis-aligned rectangle of yard cells inside the component's bbox (histogram method) */
function bestRect(comp: [number, number][], ok: (x: number, y: number) => boolean): CellRect | null {
  let best: CellRect | null = null;
  const xs = comp.map(c => c[0]), ys = comp.map(c => c[1]);
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

function serviceCorner(L: Layout, sb: SceneBuilder, rr: Rng, comp: [number, number][], avoid: CellRect | null) {
  // only paved cells outside the yard's main feature (never on grass / parking)
  const cells = comp.filter(([x, y]) => (!avoid || x < avoid.x - 1 || x > avoid.x + avoid.w || y < avoid.y - 1 || y > avoid.y + avoid.h) && !L.over[y][x]);
  if (cells.length < 4) return;
  const [x, y] = rr.pick(cells);
  const nd = rr.int(1, 3);
  for (let i = 0; i < nd; i++) sb.putFoot(rr.pick(variants(C + 'Dumpster')), x * T + 16 + i * 32, y * T + 14, 'trash', { group: 'yard' });
  for (let i = 0; i < rr.int(0, 3); i++) sb.putFoot(rr.pick(variants(C + 'Trash')), x * T + rr.int(0, nd * 32), y * T + rr.int(18, 26), 'trash', { group: 'yard' });
  if (rr.chance(0.5)) { const [lx, ly] = rr.pick(cells); sb.putFoot(rr.pick(variants(C + 'Hanging_Clothes')), lx * T + 8, ly * T + 14, 'utility', { group: 'yard' }); }
  if (rr.chance(0.4)) { const [bx, by] = rr.pick(cells); sb.putFoot(rr.pick(variants('6_Garage_Sales/Box')), bx * T + 8, by * T + 14, 'crate', { group: 'yard' }); }
}

/** perpendicular bays (2_City_Terrains cols 0-8, rows 8-12: 3 bays with a curb on top) along the top of the rect */
function parkingLot(L: Layout, sb: SceneBuilder, rr: Rng, rc: CellRect) {
  const ASPH: [number, number][] = [[1, 4], [2, 4], [0, 5], [1, 5]];
  for (let y = rc.y; y < rc.y + rc.h; y++) for (let x = rc.x; x < rc.x + rc.w; x++) { const a = rr.pick(ASPH); L.base[y][x] = ['city', a[0], a[1]]; }
  const nPieces = Math.floor(rc.w / 9);
  const px0 = rc.x + Math.floor((rc.w - nPieces * 9) / 2);
  const carsKeys = variants(V + 'Car_Down').filter(k => spr(k).w <= 48 && spr(k).h <= 80);
  for (let p = 0; p < nPieces; p++) {
    for (let j = 0; j < 5; j++) for (let i = 0; i < 9; i++) L.base[rc.y + j][px0 + p * 9 + i] = ['city', i, 8 + j];
    for (let b = 0; b < 3; b++) {
      if (!rr.chance(0.6)) continue;
      const cx = (px0 + p * 9 + 1.5 + b * 3) * T, by = (rc.y + 5) * T - 3;
      sb.putFoot(rr.pick(carsKeys), cx, by, 'vehicle', { group: 'parking_lot', depth: 40 });
    }
  }
  if (rr.chance(0.5)) {   // someone walking to their car
    const p = makePerson(rr, 'citizen');
    sb.putChar(p.layers, frameFor(p, 'walk', rr.pick(['left', 'right'] as const), rr), (rc.x + rr.int(1, rc.w - 2)) * T, (rc.y + 6) * T, 'citizen', { group: 'parking_lot' });
  }
}

/** horizontal bay pockets (2_City_Terrains cols 9-13, rows 8-11: two 5x2 bays with a curb on top), side by side */
function parkingPockets(L: Layout, sb: SceneBuilder, rr: Rng, rc: CellRect) {
  const ASPH: [number, number][] = [[1, 4], [2, 4], [0, 5], [1, 5]];
  for (let y = rc.y; y < rc.y + rc.h; y++) for (let x = rc.x; x < rc.x + rc.w; x++) { const a = rr.pick(ASPH); L.base[y][x] = ['city', a[0], a[1]]; }
  const n = Math.floor(rc.w / 5);
  const px0 = rc.x + Math.floor((rc.w - n * 5) / 2);
  for (let p = 0; p < n; p++) {
    for (let j = 0; j < 4; j++) for (let i = 0; i < 5; i++) L.base[rc.y + j][px0 + p * 5 + i] = ['city', 9 + i, 8 + j];
    for (const bay of [0, 1]) {
      if (!rr.chance(0.55)) continue;
      const dir = rr.pick(['Left', 'Right']);
      const keys = variants(V + `Car_${dir}`).filter(k => spr(k).w <= 80);
      sb.putFoot(rr.pick(keys), (px0 + p * 5 + 2.5) * T, (rc.y + 2 + bay * 2) * T - 1, 'vehicle', { group: 'parking_lot', depth: 20 });
    }
  }
}

/** fence (24_Additional_Houses fence set, one style per yard) along the yard edges that face a sidewalk, with a gate */
function fenceStreetEdges(L: Layout, sb: SceneBuilder, rr: Rng, rc: CellRect) {
  if (!rr.chance(0.7)) return;
  const set = rr.int(1, 6);
  const F = (part: string) => `24_Additional_Houses/24_Fence_${set}_${part}`;
  const put = (key: string, x: number, y: number) => { if (hasSprite(key)) sb.putAt(key, x * T, y * T, 'fence', { group: 'fence', depth: 6, ignoreClear: true }); };
  const walk = (x: number, y: number) => L.cls[y]?.[x] === 'walk';
  const top = Array.from({ length: rc.w }, (_, i) => walk(rc.x + i, rc.y - 1)).filter(Boolean).length > rc.w / 2;
  const left = walk(rc.x - 1, rc.y + 1), right = walk(rc.x + rc.w, rc.y + 1);
  if (top) {
    const gate = rr.int(rc.x + 1, rc.x + rc.w - 2);
    for (let x = rc.x; x < rc.x + rc.w; x++) {
      const part = x === gate ? `Top_Middle` : x === rc.x ? 'Top_Left' : x === rc.x + rc.w - 1 ? 'Top_Right' : 'Top_Middle';
      if (x === gate || x === gate + 1) continue;   // opening
      put(F(part), x, rc.y);
    }
  }
  for (const [side, x] of [[left, rc.x], [right, rc.x + rc.w - 1]] as const) {
    if (!side) continue;
    for (let y = rc.y + (top ? 1 : 0); y < rc.y + rc.h; y++) put(F(x === rc.x ? 'Middle_Left' : 'Middle_Right'), x, y);
  }
}

/** grass 9-slice (1_Terrains cols 0-2, rows 11-13, transparent edges) with small trees, benches and people */
function garden(L: Layout, sb: SceneBuilder, rr: Rng, rc: CellRect) {
  for (let y = rc.y; y < rc.y + rc.h; y++) for (let x = rc.x; x < rc.x + rc.w; x++) {
    const cx = x === rc.x ? 0 : x === rc.x + rc.w - 1 ? 2 : 1, cy = y === rc.y ? 11 : y === rc.y + rc.h - 1 ? 13 : 12;
    L.over[y][x] = ['terr', cx, cy];
  }
  const trees = [C + 'Tree_1', C + 'Tree_8', C + 'Tree_3', C + 'Tree_5'].filter(hasSprite);
  const n = Math.max(1, Math.floor(rc.w * rc.h / 14));
  for (let i = 0; i < n; i++) sb.putFoot(rr.pick(trees), (rc.x + rr.int(1, rc.w - 2)) * T + rr.int(0, 15), (rc.y + rr.int(2, rc.h - 1)) * T + rr.int(0, 12), 'tree', { group: 'garden' });
  for (let i = 0; i < rr.int(1, 2); i++) {
    const bx = (rc.x + rr.int(1, rc.w - 3)) * T + 8, by = (rc.y + rr.int(1, rc.h - 2)) * T + 14;
    if (sb.putFoot(C + 'Bench_1', bx, by, 'bench', { group: 'garden' }) && rr.chance(0.6)) {
      const p = makePerson(rr, 'resident'); sb.putChar(p.layers, frameFor(p, 'sit', 'right'), bx - 4, by - 4, 'resident', { group: 'garden' });
    }
  }
  for (let i = 0; i < rr.int(0, 3); i++) sb.putFoot(rr.pick(variants(C + 'Flower_Bush')), (rc.x + rr.int(0, rc.w - 2)) * T + 16, (rc.y + rr.int(0, rc.h - 1)) * T + 14, 'plant', { group: 'garden' });
  if (rr.chance(0.4)) { const p = makePerson(rr, 'kid', { kid: true }); sb.putChar(p.layers, frameFor(p, 'stand', rr.pick(['down', 'left', 'right'] as const)), (rc.x + rr.int(1, rc.w - 2)) * T, (rc.y + rr.int(1, rc.h - 1)) * T + 12, 'kid', { group: 'garden' }); }
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
    for (const [x, y] of cs) if (L.cls[y][x] === 'nlot') L.base[y][x] = slab(rr.pick(['sidewalk_beige', 'sidewalk_brown', 'sidewalk_lightbeige']), x, y);
    const centre = rr.weighted([['kiosk', 2], ['fountain', 1], ['billboard', 1], ['tree', 1]] as const);
    if (centre === 'kiosk') sb.putFoot(rr.pick([C + 'Kiosk_Infopoint_1', C + 'Kiosk_Coffee_Cup', C + 'Kiosk_Icecream', C + 'Kiosk_Mushroom'].filter(hasSprite)), cx, cy + 22, 'kiosk', { group: 'island' });
    if (centre === 'fountain') sb.putFoot(rr.pick(variants(C + 'Fountain')), cx, cy + 14, 'utility', { group: 'island' });
    if (centre === 'billboard') sb.putFoot(rr.pick(variants(C + 'Billboard', [2, 3, 5, 6, 7, 8])), cx, cy + 30, 'info_sign', { group: 'island' });
    if (centre === 'tree') sb.putFoot(C + 'Tree_13', cx, cy + 16, 'tree', { group: 'island' });
    for (const sx of [-1, 1]) if (rr.chance(0.7)) sb.putFoot(rr.pick([C + 'Tree_11', C + 'Tree_13']), cx + sx * ((x1 - x0) / 2 - 1.5) * T, cy + rr.int(-8, 16), 'tree', { group: 'island' });
    if (rr.chance(0.7)) sb.putFoot(C + 'Bench_2', cx + rr.int(-20, 20), y1 * T - 10, 'bench', { group: 'island' });
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
  const run = r.pick(cand);
  const s = r.int(run.a + 3 * T, run.b - 5 * T);
  const fy = run.fixed + 1;
  const shelterKey = r.pick([V + 'Bus_Stop_1', V + 'Bus_Stop_2']);
  const sh = sb.putFoot(shelterKey, s, fy - 2, 'bus_stop', { group: 'bus', ignoreClear: true });
  sb.putFoot(r.pick(variants(V + 'Bus_Stop_Sign')), s + 52, fy, 'bus_stop', { group: 'bus', ignoreClear: true });
  sb.clear(rect(s - 56, fy - 30, s + 64, fy + 6), 'bus stop');
  if (sh) {
    if (r.chance(0.8)) person(sb, r, s - 14 + r.int(0, 20), fy - 10, 'sit', r.pick(['left', 'right'] as const), 'waiting', 'bus');
    for (let i = 0; i < r.int(0, 2); i++) person(sb, r, s + r.int(-50, 70), fy - r.int(2, 8), r.chance(0.5) ? 'stand' : 'phone', 'down', 'waiting', 'bus');
    sb.putFoot(r.pick(variants(C + 'Trashbin')), s - 52, fy - 4, 'trash', { group: 'bus', ignoreClear: true });
  }
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
  const manholes = variants(C + 'Manhole');
  for (const sg of L.segs) {
    if (sg.b - sg.a < 6) continue;
    for (let i = 0; i < r.int(0, 2); i++) {
      const p = r.int(sg.a, sg.b - 1) * T + 8, q = r.int(sg.band0 + 1, sg.band1 - 2) * T + r.int(4, 12);
      const [fx, fy] = sg.axis === 'h' ? [p, q] : [q, p];
      sb.putFoot(r.pick(manholes), fx, fy, 'manhole', { group: 'road', depth: 4 });
    }
  }
  // road works (rare): hole + barriers + cones in a lane
  if (r.chance(0.25)) {
    const sg = r.pick(L.segs.filter(s => s.b - s.a >= 10));
    if (sg) {
      const p = r.int(sg.a + 2, sg.b - 4) * T;
      const q = (sg.band0 + 1) * T + 8;
      const [fx, fy] = sg.axis === 'h' ? [p, q + 10] : [q, p];
      sb.putFoot(r.pick(variants(C + 'Holes').filter(k => spr(k).w >= 32)), fx, fy, 'roadworks', { group: 'works', depth: 6 });
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
