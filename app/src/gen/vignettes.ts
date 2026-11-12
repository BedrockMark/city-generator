// Functional groups ("vignettes") and the curb rhythm strip. Each placement has a reason:
// crossings -> traffic lights at both ends; doors -> what that kind of shop puts outside; alleys -> bins;
// curb strip -> trees/lamps/bollards with a per-street beat, interrupted by crossings, doors, bus stops.
// Every group instance is registered with sb.group() (gid, trigger, anchor) and every placement says why.
import { Rng } from './rng';
import type { Layout, Seg } from './layout';
import type { BlockPlan, PlacedBuilding } from './block';
import { SceneBuilder, rect, type PutOpts } from './place';
import { spr, variants, hasSprite } from './assets';
import { makePerson, frameFor, type Dir, type Pose } from './people';
import { TILE, type Anchor, type Placed } from './types';
import { slab, orgOf } from './layout';

const C = '3_City_Props/';
const V = '10_Vehicles/';
const T = TILE;

export function person(sb: SceneBuilder, r: Rng, fx: number, fy: number, pose: Pose, dir: Dir, role: string, gid: string, why: string, kid = false) {
  const p = makePerson(r, role, { kid });
  return sb.putChar(p.layers, frameFor(p, pose, dir, r), fx, fy, role, { gid, why });
}

// ------------------------------------------------------------------------------------------------
// curb runs: straight sequences of sidewalk cells that touch the road on one side

export interface CurbRun { id: string; side: 'S' | 'N' | 'E' | 'W'; main: boolean; fixed: number; curb: number; a: number; b: number; region: number; sw: number }
// side = where the ROAD is relative to the sidewalk. fixed = furniture foot line (px); curb = px of the curb line; a..b = px range along;
// sw = sidewalk depth in cells

/** a run's stream label: side, foot line and start in world px (orgOf), so it does not depend on the window */
function runLabel(L: Layout, run: CurbRun): string {
  const [ox, oy] = orgOf(L), h = run.side === 'S' || run.side === 'N';
  return `${run.side}${run.fixed + (h ? oy : ox) * T}${run.a + (h ? ox : oy) * T}`;
}

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
        out.push({ id: `run${out.length}`, side, main, fixed, curb, a: j * T, b: e * T, region: main ? -1 : L.region[y][x], sw });
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

/** point on the curb line of a run (default: its middle) */
export const curbAnchor = (run: CurbRun, along = (run.a + run.b) / 2): Anchor =>
  run.side === 'S' || run.side === 'N' ? { kind: 'curb', ref: run.id, x: along, y: run.curb } : { kind: 'curb', ref: run.id, x: run.curb, y: along };

/** the sidewalk strip of a run (px) */
export const runRect = (run: CurbRun) => {
  const d = run.sw * T;
  return run.side === 'S' ? rect(run.a, run.curb - d, run.b, run.curb) : run.side === 'N' ? rect(run.a, run.curb, run.b, run.curb + d)
    : run.side === 'E' ? rect(run.curb - d, run.a, run.curb, run.b) : rect(run.curb, run.a, run.curb + d, run.b);
};

const SIDE_NAMES = { S: '马路在南', N: '马路在北', E: '马路在东', W: '马路在西' } as const;
const runName = (run: CurbRun) => `${run.id}（${run.main ? '主街区' : '邻近街区'}人行道，${SIDE_NAMES[run.side]}，长 ${Math.round((run.b - run.a) / T)} 格）`;

/** the pedestrian lane of each sidewalk stays clear: a band between the curb furniture and the facade zone */
export function reserveWalkways(sb: SceneBuilder, runs: CurbRun[]) {
  const why = '通行带：人行道上路缘设施和楼前设施之间留给行人的带，物件不能放（D17）';
  for (const u of runs) {
    if (u.side === 'S') sb.clear(rect(u.a, u.curb - 22, u.b, u.curb - 14), 'walkway', why);
    else if (u.side === 'N') sb.clear(rect(u.a, u.curb + 16, u.b, u.curb + 28), 'walkway', why);
    else {
      const off = u.sw >= 3 ? 30 : 16;
      if (u.side === 'E') sb.clear(rect(u.curb - off - 10, u.a, u.curb - off, u.b), 'walkway', why);
      else sb.clear(rect(u.curb + off, u.a, u.curb + off + 10, u.b), 'walkway', why);
    }
  }
}

// ------------------------------------------------------------------------------------------------

export function crossingVignettes(L: Layout, sb: SceneBuilder, r0: Rng) {
  let r = r0;
  const lights = variants(C + 'Traffic_Light', [1, 2, 5]);
  const isWalk = (x: number, y: number) => L.cls[y]?.[x] === 'walk' || L.cls[y]?.[x] === 'nwalk';
  for (const [ci, c] of L.crossings.entries()) {
    // city mode: one stream per crossing, keyed by its world position, so the blocks on either side of the road decide
    // its lights the same way; single-block mode: one stream for all (unchanged)
    const [ox, oy] = orgOf(L);
    if (L.org) r = sb.enter(r0.fork(`xing${c.axis}${c.band0 + (c.axis === 'h' ? oy : ox)},${c.at + (c.axis === 'h' ? ox : oy)}`));
    const zx = c.axis === 'h' ? (c.at + 1) * T : (c.band0 + c.band1) / 2 * T, zy = c.axis === 'h' ? (c.band0 + c.band1) / 2 * T : (c.at + 1) * T;
    const gid = sb.group('crossing', `人行横道 zebra${ci}：路口附近的横道，配红绿灯（参考图中红绿灯总在横道端头，lift 6.2）`, { anchor: { kind: 'crossing', ref: `zebra${ci}`, x: zx, y: zy } });
    const key = r.choose('cross.lightModel', {}, lights);
    const flip = r.choose('cross.flip', {}, { p: 0.5 });
    // per end: the two candidate pole positions (either side of the zebra), first = preferred
    const ends: { opts: [number, number][]; face: Dir }[] = [];
    if (c.axis === 'h') {
      const x0 = c.at * T, x1 = (c.at + 2) * T;
      for (const [y, end] of [[c.band0 - 1, 'N'], [c.band1, 'S']] as const) {
        if (!isWalk(c.at, y)) continue;
        const fy = end === 'N' ? (y + 1) * T - 3 : y * T + 13;
        sb.clear(rect(x0 - 4, y * T, x1 + 4, (y + 1) * T + (end === 'N' ? 0 : T)), 'crossing', `横道口（zebra${ci}）：行人上下横道的地方保持畅通`, gid);
        const left = (end === 'N') !== flip;
        const o: [number, number][] = [[x0 - 7, fy], [x1 + 7, fy]];
        ends.push({ opts: left ? o : [o[1], o[0]], face: end === 'N' ? 'down' : 'up' });
      }
    } else {
      const y0 = c.at * T, y1 = (c.at + 2) * T;
      for (const [x, end] of [[c.band0 - 1, 'W'], [c.band1, 'E']] as const) {
        if (!isWalk(x, c.at)) continue;
        const fx = end === 'W' ? (x + 1) * T - 7 : x * T + 7;
        sb.clear(rect(x * T - (end === 'W' ? T : 0), y0 - 4, (x + 1) * T + (end === 'E' ? T : 0), y1 + 4), 'crossing', `横道口（zebra${ci}）：行人上下横道的地方保持畅通`, gid);
        const above = (end === 'W') !== flip;
        const o: [number, number][] = [[fx, y0 - 3], [fx, y1 + 12]];
        ends.push({ opts: above ? o : [o[1], o[0]], face: end === 'W' ? 'right' : 'left' });
      }
    }
    // usually a pole at one end only; sometimes both
    const both = ends.length === 2 && r.choose('cross.bothEnds', {}, { p: 0.35 });
    const order = r.order('cross.endOrder', {}, [...ends.keys()]);
    let placed = 0;
    for (const i of order) {
      if (placed >= (both ? 2 : 1)) break;
      for (const [fx, fy] of ends[i].opts) {
        // the pole must stand on the pavement, never in the carriageway
        if (!sb.putFoot(key, fx, fy, 'traffic_light', { gid, why: '红绿灯：立在横道端头的人行道上（不进车道）', ignoreClear: ['crossing', 'walkway'], walk: true })) continue;
        placed++;
        if (r.choose('cross.waiting', {}, { p: 0.35 })) person(sb, r, fx + (r.choose('cross.waitingSide', {}, { p: 0.5 }) ? 14 : -14), fy + 2, 'stand', ends[i].face, 'citizen', gid, '在红绿灯旁等着过马路的行人，面朝横道');
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

const FURNITURE_NAMES = { trees: '行道树', planters: '花箱', bollards: '护柱', none: '不放（这条街保持朴素）' } as const;

export function curbStrips(L: Layout, sb: SceneBuilder, r: Rng, runs: CurbRun[]) {
  const LAMP_R = [C + 'Street_Lamp_1', C + 'Street_Lamp_2', C + 'Street_Lamp_3'], LAMP_L = [C + 'Street_Lamp_4'];
  const streetLamp = r.choose('curb.streetLampModel', {}, [...LAMP_R, C + 'Street_Lamp_5']);
  void L;
  for (const run of runs) {
    const len = run.b - run.a;
    sb.enter(r);
    if (len < 4 * T) { sb.zone('curb', 'curb:short', runRect(run), `路缘段 ${runName(run)}：太短（<4 格），不放路缘设施`); continue; }
    const rr = sb.enter(r.fork(`curb${runLabel(L, run)}`, { run: run.id, side: run.side, main: run.main, sw: run.sw, len: Math.round(len / T) }));
    const horiz = run.side === 'S' || run.side === 'N';
    const put = (key: string, along: number, cls: string, gid: string, why: string, inset = 0) => {
      const [fx, fy] = footAt(run, along, inset);
      return sb.putFoot(key, fx, fy, cls, { gid, why, anchor: curbAnchor(run, along), walk: true, pad: 3 });
    };
    // ---- lamps ----
    let lamps = false;
    if (rr.choose('curb.lamps', { main: run.main }, { p: run.main ? 0.7 : 0.35 })) {
      lamps = true;
      const lamp = run.side === 'W' ? rr.choose('curb.lampModel', { side: run.side }, LAMP_L) : run.side === 'E' ? rr.choose('curb.lampModel', { side: run.side }, LAMP_R) : streetLamp;
      const step = rr.int(8, 12) * T;
      const gid = sb.group('curb-lamps', `路灯：这条街抽中“有路灯”（主街区 70%，邻近街区 35%），约每 ${step / T} 格一盏，灯臂伸向马路`, { id: run.id, anchor: curbAnchor(run) });
      for (let s = run.a + rr.int(20, 40); s < run.b - 16; s += step + rr.int(-1, 1) * T) put(lamp, s + rr.jitter(2), 'street_lamp', gid, '路灯，立在路缘设施线上');
    }
    // ---- trees or low furniture ----
    const treeOk = run.side === 'S' || run.sw >= 3;
    const what = rr.choose('curb.furniture', { main: run.main, treeOk, horiz }, { weights: [
      ['trees', treeOk ? (run.main ? 3 : 1.2) : 0], ['planters', horiz && run.main ? 1 : 0], ['bollards', run.main ? 1 : 0.6], ['none', run.main ? 1.2 : 2.5],
    ] as const });
    sb.zone('curb', `curb:${what}`, runRect(run), `路缘段 ${runName(run)}：${lamps ? '有路灯' : '没有路灯'}；路缘设施抽到“${FURNITURE_NAMES[what]}”${treeOk ? '' : '（人行道太窄且马路在北，不种树：树冠会盖住车道）'}`);
    if (what === 'trees') {
      const tree = rr.choose('curb.treeModel', {}, [C + 'Tree_11', C + 'Tree_13', C + 'Tree_13']);
      const inset = horiz ? (run.side === 'N' ? 8 : 0) : 8;
      const gid = sb.group('curb-trees', '行道树：这条街的路缘设施抽到“树”，间距 3–7 格不等，偶尔缺一棵（D20）', { id: run.id, anchor: curbAnchor(run) });
      // irregular: gaps of 3-7 cells, sometimes a missing tree
      for (let s = run.a + rr.int(24, 56); s < run.b - 20;) {
        if (!rr.choose('curb.treeGap', {}, { p: 0.15 })) put(tree, s + rr.jitter(3), 'tree', gid, '行道树', inset);
        s += rr.choose('curb.treeSpacing', {}, { weights: [[3, 1], [4, 3], [5, 3], [6, 2], [7, 1]] as const }) * T + rr.int(-4, 4);
      }
    } else if (what === 'planters' || what === 'bollards') {
      const planter = rr.choose('curb.planterModel', {}, variants(C + 'Flower_Bush', [1, 2, 3]));
      const bollard = rr.choose('curb.bollardModel', {}, [C + 'Pole_1', ...variants(C + 'Pedestrian_Barrier_Post', [1, 2, 3, 6, 7])]);
      // a short group of them near one end of the run (corners are where people cut across)
      const nearA = rr.choose('curb.groupAtStart', {}, { p: 0.5 });
      const groupAt = nearA ? run.a + rr.int(24, 48) : run.b - rr.int(48, 96);
      const n = rr.count('curb.groupSize', {}, 3, 6);
      const gid = sb.group(`curb-${what}`, `街角附近的一小组${what === 'planters' ? '花箱和护柱' : '护柱'}：挡住在街角抄近路的车和人（D20）`, { id: run.id, anchor: curbAnchor(run, groupAt) });
      for (let k = 0; k < n; k++) put(what === 'planters' && k % 2 === 0 ? planter : bollard, groupAt + k * (what === 'planters' ? 24 : 20), what === 'planters' ? 'plant' : 'bollard', gid, what === 'planters' && k % 2 === 0 ? '花箱' : '护柱');
    }
    // ---- a bin near a corner, a hydrant at the curb ----
    if (rr.choose('curb.bin', { main: run.main }, { p: run.main ? 0.6 : 0.3 })) {
      const key = rr.choose('curb.binModel', {}, variants(C + 'Trashbin'));
      const along = rr.choose('curb.binAtStart', {}, { p: 0.5 }) ? run.a + rr.int(18, 40) : run.b - rr.int(18, 40);
      const gid = sb.group('curb-bin', '路边垃圾桶：放在路段一端，靠近街角（行人在这里转弯）', { id: run.id, anchor: curbAnchor(run, along) });
      put(key, along, 'trash', gid, '街角附近的垃圾桶');
    }
    if (run.main && len > 8 * T && rr.choose('curb.hydrant', {}, { p: 0.45 })) {
      const key = rr.choose('curb.hydrantModel', {}, variants(C + 'Hydrant'));
      const along = rr.choose('curb.hydrantAtStart', {}, { p: 0.5 }) ? run.a + rr.int(40, 80) : run.b - rr.int(40, 80);
      const gid = sb.group('curb-hydrant', '消防栓：主街区较长的路段上，立在路缘（消防车能停靠的位置）', { id: run.id, anchor: curbAnchor(run, along) });
      put(key, along, 'hydrant', gid, '路缘上的消防栓');
    }
  }
}

// ------------------------------------------------------------------------------------------------
// shop fronts: things hug the facade beside the door (never in front of it, never in the walkway)

const signs = () => [...variants(C + 'Info_Sign'), ...variants('9_Shopping_Center_and_Markets/Sign').filter(hasSprite)];

const FRONT_REASONS: Record<string, string> = {
  cafe: '餐饮店门前：门两侧放露天桌椅、立牌，有顾客', bakery: '面包店门前：门两侧放露天桌椅、立牌，有顾客',
  retail: '零售店门前：门两侧对称的盆栽、立牌、垃圾桶，看橱窗的顾客', hardware: '五金店门前：盆栽、立牌、垃圾桶、顾客',
  market: '超市门前：盆栽、立牌、垃圾桶，进出的顾客较多', condo: '住宅门前：花丛、信箱、垃圾桶，偶尔有住户',
  house: '住宅门前：花丛、信箱、垃圾桶，偶尔有住户', office: '办公楼门前：门两侧的盆栽、垃圾桶，进出的上班族',
  hotel: '酒店门前：门两侧的盆栽，行李车，进出的客人', gym: '健身房门前：门口有人，旁边一个垃圾桶', closed: '歇业的店（卷帘门）：门口堆着垃圾袋和纸箱',
};

export function frontVignettes(L: Layout, plan: BlockPlan, sb: SceneBuilder, r: Rng) {
  // a building made by an experiment (exp-05) tags what stands in front of it too
  for (const pb of plan.buildings) {
    if (pb.plan.front === 'landmark') continue;   // exp-08: the district's forecourt (district.ts) is its front
    if (pb.plan.exp) sb.withExp(pb.plan.exp, () => frontOf(L, pb, sb, r));
    else frontOf(L, pb, sb, r);
  }
}

function frontOf(L: Layout, pb: PlacedBuilding, sb: SceneBuilder, r: Rng) {
  const rr = sb.enter(r.fork(pb.plan.id, { building: pb.plan.id, front: pb.plan.front, side: pb.side }));
  const { plan: b, cx, cy } = pb;
  const x0 = cx * T, bottom = (cy + b.h) * T;
  // how deep is the free strip in front of the facade (cells, until road / building)
  let depth = 0;
  for (let y = cy + b.h; y < L.rows && (L.cls[y][cx + 1] === 'walk' || L.cls[y][cx + 1] === 'lot') && depth < 6; y++) depth++;
  const door = b.doors[0] ?? b.w * T / 2;
  const dx = x0 + door;
  const g = sb.group('front', `${b.id}（${b.label}）的${FRONT_REASONS[b.front]}`, { id: b.id, anchor: { kind: 'door', ref: `${b.id}.door`, x: dx, y: bottom } });
  const side = rr.choose('front.side', {}, { p: 0.5 }) ? 1 : -1;
  const base = bottom + 10;          // foot line hugging the facade
  const put = (key: string, fx: number, fy: number, cls: string, why: string) => sb.putFoot(key, fx, fy, cls, { gid: g, why, depth: 9 });
  const tableAnchor = (tx: number, ty: number, i: number): Anchor => ({ kind: 'object', ref: `${g}/table${i}`, x: tx, y: ty });
  switch (b.front) {
    case 'cafe': case 'bakery': {
      if (b.front === 'cafe' && b.label.startsWith('Ice_Cream') && hasSprite('5_Floor_Modular_Building/Ground_Floor_Ice_Cream_Shop_Props_3'))
        put('5_Floor_Modular_Building/Ground_Floor_Ice_Cream_Shop_Props_3', dx + (door > 56 ? -48 : 44), base + 12, 'table', '冰淇淋店配套的门口道具');
      // tables only where the pavement leaves room for them (the walkway check rejects the rest)
      const table = rr.choose('front.tableModel', {}, variants(V + 'Street_Food_Table'));
      for (let i = 0; i < rr.count('front.tables', {}, 1, 3); i++) {
        const tx = x0 + 12 + rr.int(0, 6) + i * 34;
        if (Math.abs(tx - dx) < 22) continue;
        const ty = bottom + 20;
        if (!sb.putFoot(table, tx, ty, 'table', { gid: g, why: '露天座位的桌子：贴着立面、避开门前通道' })) continue;
        for (const [sx, dir] of [[-12, 'right'], [12, 'left']] as const) {
          const anchor = tableAnchor(tx, ty, i);
          if (rr.choose('front.seatTaken', {}, { p: 0.55 })) { if (!sb.putChar(...seated(rr, tx + sx, ty - 1, dir), 'customer', { gid: g, why: '坐在桌旁的顾客，面朝桌子', anchor })) sb.putFoot(V + 'Street_Food_Chair_1', tx + sx, ty - 2, 'chair', { gid: g, why: '桌旁的椅子', anchor }); }
          else sb.putFoot(V + 'Street_Food_Chair_1', tx + sx, ty - 2, 'chair', { gid: g, why: '桌旁的空椅子', anchor });
        }
      }
      put(rr.choose('front.signModel', {}, signs()), dx + side * 22, base, 'info_sign', '店招立牌，放在门的一侧');
      if (rr.choose('front.customer', {}, { p: 0.6 })) person(sb, rr, dx + side * rr.int(10, 30), base + rr.int(6, 12), 'stand', 'up', 'customer', g, '在店门口张望的顾客，面朝店门');
      break;
    }
    case 'retail': case 'hardware': case 'market': {
      const shrub = rr.choose('front.potModel', {}, [C + 'Shrub_3', C + 'Shrub_4', ...variants(C + 'Pot')]);
      if (rr.choose('front.pots', {}, { p: 0.7 })) { put(shrub, dx - 22, base, 'plant', '门两侧对称的盆栽（左）'); put(shrub, dx + 22, base, 'plant', '门两侧对称的盆栽（右）'); }
      if (rr.choose('front.sign', {}, { p: 0.55 })) put(rr.choose('front.signModel', {}, signs()), dx + side * 34, base, 'info_sign', '店招立牌，放在门的一侧');
      if (rr.choose('front.bin', {}, { p: 0.5 })) put(rr.choose('front.binModel', {}, variants(C + 'Trashbin')), dx - side * rr.int(38, 52), base, 'trash', '店门旁的垃圾桶（与立牌分在门的两侧）');
      const n = b.front === 'market' ? rr.count('front.customers', { market: true }, 1, 3) : rr.count('front.customers', { market: false }, 0, 2);
      for (let i = 0; i < n; i++) person(sb, rr, dx + rr.int(-40, 40), base + rr.int(6, 14), rr.choose('front.customerPose', {}, { p: 0.7 }) ? 'stand' : 'phone', rr.choose('front.customerDir', {}, ['up', 'up', 'left', 'right'] as const), 'customer', g, '店门口的顾客（看橱窗或打电话）');
      break;
    }
    case 'condo': case 'house': {
      const fl = rr.choose('front.flowerModel', {}, variants(C + 'Flower_Bush'));
      if (rr.choose('front.flowers', {}, { p: 0.6 })) { put(fl, dx - 32, base, 'plant', '住宅门旁的花丛'); if (rr.choose('front.flowersBoth', {}, { p: 0.6 })) put(fl, dx + 32, base, 'plant', '住宅门旁的花丛（另一侧）'); }
      if (rr.choose('front.mailbox', {}, { p: 0.35 })) put(C + 'Mailbox_1', dx + side * 20, base, 'utility', '住宅门口的信箱');
      if (rr.choose('front.bin', {}, { p: 0.25 })) put(rr.choose('front.binModel', {}, variants(C + 'Trashbin')), dx - side * rr.int(40, 60), base, 'trash', '住户的垃圾桶，放在门的另一侧');
      if (rr.choose('front.resident', {}, { p: 0.35 })) person(sb, rr, dx + rr.int(-20, 20), base + rr.int(4, 12), rr.choose('front.residentPose', {}, { p: 0.5 }) ? 'stand' : 'phone', rr.choose('front.residentDir', {}, ['down', 'left', 'right'] as const), 'resident', g, '在家门口的住户');
      break;
    }
    case 'gym': {
      if (rr.choose('front.person', {}, { p: 0.7 })) person(sb, rr, dx + side * 16, base + 8, 'stand', 'down', 'citizen', g, '健身房门口的人');
      put(rr.choose('front.binModel', {}, variants(C + 'Trashbin')), dx + side * 40, base, 'trash', '健身房门旁的垃圾桶');
      break;
    }
    case 'office': {
      // exp-05 office: planters either side of the entrance, a bin, people coming and going (phone in hand)
      const pot = rr.choose('front.potModel', {}, variants('17_Garden/Bush_Potted'));
      if (rr.choose('front.pots', {}, { p: 0.75 })) { put(pot, dx - 30, base, 'plant', '办公楼入口两侧的盆栽（左）'); put(pot, dx + 30, base, 'plant', '办公楼入口两侧的盆栽（右）'); }
      if (rr.choose('front.bin', {}, { p: 0.5 })) put(rr.choose('front.binModel', {}, variants(C + 'Trashbin')), dx + side * rr.int(44, 60), base, 'trash', '办公楼门旁的垃圾桶');
      for (let i = 0; i < rr.count('front.workers', {}, 0, 2); i++) person(sb, rr, dx + rr.int(-36, 36), base + rr.int(6, 14), rr.choose('front.workerPose', {}, { p: 0.5 }) ? 'stand' : 'phone', rr.choose('front.workerDir', {}, ['down', 'left', 'right', 'up'] as const), 'citizen', g, '办公楼门口进出的上班族');
      break;
    }
    case 'hotel': {
      // exp-05 hotel: planters framing the entrance, a luggage trolley beside it, guests
      const pot = rr.choose('front.potModel', {}, variants('17_Garden/Bush_Potted'));
      put(pot, dx - 34, base, 'plant', '酒店入口两侧的盆栽（左）'); put(pot, dx + 34, base, 'plant', '酒店入口两侧的盆栽（右）');
      if (rr.choose('front.trolley', {}, { p: 0.7 })) put(rr.choose('front.trolleyModel', {}, variants('12_Hotel_and_Hospital/Luggage_Trolley')), dx + side * 22, base + 4, 'utility', '酒店门口的行李车');
      for (let i = 0; i < rr.count('front.guests', {}, 1, 3); i++) person(sb, rr, dx + rr.int(-44, 44), base + rr.int(6, 14), rr.choose('front.guestPose', {}, { p: 0.6 }) ? 'stand' : 'phone', rr.choose('front.guestDir', {}, ['down', 'up', 'left', 'right'] as const), 'customer', g, '酒店门口的客人');
      break;
    }
    case 'closed': {
      if (rr.choose('front.litter', {}, { p: 0.6 })) for (let i = 0; i < rr.count('front.litterBags', {}, 1, 3); i++) put(rr.choose('front.litterModel', {}, variants(C + 'Trash')), dx + side * rr.int(20, 44), base, 'trash', '歇业店门口堆积的垃圾袋');
      if (rr.choose('front.cardboard', {}, { p: 0.3 })) put(rr.choose('front.cardboardModel', {}, variants(C + 'Cardboard_Trash')), dx - side * rr.int(20, 36), base, 'trash', '歇业店门口的废纸箱');
      break;
    }
  }
}

/** a seated customer: same draws as person(sb, r, fx, fy, 'sit', dir, 'customer', ...) */
function seated(r: Rng, fx: number, fy: number, dir: Dir): [string[], [number, number], number, number] {
  const p = makePerson(r, 'customer', { kid: false });
  return [p.layers, frameFor(p, 'sit', dir, r), fx, fy];
}

// ------------------------------------------------------------------------------------------------
// alleys, plaza, pockets

/** sprite k with its foot at (fx, fy) would hide a building's door: the door behind it, its picture over the door (C24) */
export function hidesDoor(sb: SceneBuilder, k: string, fx: number, fy: number): boolean {
  const s = spr(k), hw = (s.bb[2] - s.bb[0]) / 2, top = fy - (s.bb[3] - s.bb[1]);
  return sb.buildings.some(b => b.doors.some(d => fy > d.y && d.x >= fx - hw && d.x < fx + hw && d.y - 12 >= top));
}

/** puts sprite k, its foot at y fy, at the x nearest to fx (fx, then 1, 2 ... cells right, then left) where it is not
 *  blocked and hides no building's door (C24: a door behind it, its picture over the door); moved off fx, it stays
 *  within [xa, xb). Null: nowhere; else the sprite and its foot x */
export function putClearOfDoors(sb: SceneBuilder, k: string, xa: number, xb: number, fx: number, fy: number, cls: string, o: PutOpts): { p: Placed; x: number } | null {
  const s = spr(k), hw = (s.bb[2] - s.bb[0]) / 2;
  const hides = (x: number) => hidesDoor(sb, k, x, fy);
  for (let i = 0; i * T <= xb - xa; i++) for (const sg of i ? [1, -1] : [1]) {
    const x = fx + sg * i * T;
    if (!(i === 0 || (x - hw >= xa && x + hw <= xb)) || hides(x)) continue;
    const p = sb.putFoot(k, x, fy, cls, { ...o, why: i ? `${o.why}；从正中挪开 ${i} 格，免得挡住后面楼的门或别的东西` : o.why });
    if (p) return { p, x };
  }
  return null;
}

export function zoneVignettes(L: Layout, plan: BlockPlan, sb: SceneBuilder, r: Rng) {
  for (const z of plan.zones) {
    const rr = sb.enter(r.fork(`zone${z.x0 + orgOf(L)[0]},${z.y0 + orgOf(L)[1]}`, { zone: z.kind, w: z.x1 - z.x0, h: z.y1 - z.y0 }));
    const w = (z.x1 - z.x0) * T, x0 = z.x0 * T, y0 = z.y0 * T, y1 = z.y1 * T;
    const gid = sb.group(z.kind, z.why, { anchor: { kind: 'zone', ref: `${z.kind}@${z.x0},${z.y0}`, x: x0 + w / 2, y: y1 } });
    sb.zone('block', z.kind, rect(x0, y0, x0 + w, y1), z.why, gid);
    if (z.kind === 'alley') {
      // the way through stays clear; bins stand against the wall at the far (inner) end
      sb.clear(rect(x0 + (w >= 32 ? 18 : 2), y0 + 2 * T, x0 + w - 2, y1 + L.sw * T), 'alley', '巷子的通行道：从街上进巷子的路保持畅通', gid);
      const n = rr.count('alley.bins', {}, 1, 2);
      for (let i = 0; i < n; i++) {
        const key = w >= 32 ? rr.choose('alley.dumpsterModel', {}, variants(C + 'Dumpster').filter(k => spr(k).w <= 32)) : rr.choose('alley.binModel', {}, variants(C + 'Trashbin'));
        sb.putFoot(key, x0 + (w >= 32 ? 16 : w / 2), y0 + 26 + i * 22, 'trash', { gid, why: '巷子尽头贴墙的垃圾箱（服务通道）', ignoreClear: true });
      }
      for (let i = 0; i < rr.count('alley.litter', {}, 0, 2); i++) sb.putFoot(rr.choose('alley.litterModel', {}, variants(C + 'Trash')), x0 + (w >= 32 ? rr.int(4, 14) : rr.int(4, w - 4)), y0 + rr.int(30, 44), 'trash', { gid, why: '垃圾箱旁的垃圾袋', ignoreClear: true });
      if (rr.choose('alley.laundry', {}, { p: 0.3 })) sb.putFoot(rr.choose('alley.laundryModel', {}, variants(C + 'Hanging_Clothes')), x0 + w / 2, y0 + rr.int(3, 5) * T, 'utility', { gid, why: '巷子里晾的衣服', ignoreClear: true, occupy: false });
      if (rr.choose('alley.person', {}, { p: 0.25 })) person(sb, rr, x0 + w / 2, y1 - rr.int(40, 80), 'phone', 'down', 'citizen', gid, '躲进巷子打电话的人');
    } else if (z.kind === 'plaza') {
      const paving = rr.choose('plaza.paving', {}, ['sidewalk_beige', 'sidewalk_lightbeige', 'sidewalk_brown'].filter(st => st !== L.mainStyle));
      for (let y = z.y0; y < z.y1; y++) for (let x = z.x0; x < z.x1; x++) L.base[y][x] = slab(paving, x, y);
      // centre piece a little above the middle so there is room in front of it
      const cyp = y0 + (y1 - y0) * 0.45;
      let cxp = x0 + w / 2;
      const centre = rr.choose('plaza.centre', {}, { weights: [['fountain', 2], ['tree', 2], ['kiosk', 1]] as const });
      const ck = centre === 'fountain' ? rr.choose('plaza.fountainModel', {}, variants(C + 'Fountain'))
        : centre === 'tree' ? rr.choose('plaza.treeModel', {}, [C + 'Tree_11', C + 'Tree_13'])
        : rr.choose('plaza.kioskModel', {}, [C + 'Kiosk_Infopoint_1', C + 'Kiosk_Coffee_Cup', C + 'Kiosk_Icecream'].filter(hasSprite));
      // where it hides no door (C24; 406829 L2, 0.8.1-hotfix1 w345688 b4,5/LLLL L1 "应该移到右侧"): the middle, else 1, 2
      // ... cells to the right, then the left, overhanging the plaza by 3 cells at most. Nowhere: a smaller piece (the
      // fountains, then the trees; the plaza stays lively), else no centre piece and no benches facing it
      const dyOf = (k: string) => k.includes('Fountain') ? 12 : k.includes('Tree') ? 14 : 20;
      const clsOf = (k: string) => k.includes('Fountain') ? 'utility' : k.includes('Tree') ? 'tree' : 'kiosk';
      const pieces = [ck, ...[...variants(C + 'Fountain'), C + 'Tree_13', C + 'Tree_11'].filter(k => k !== ck && (centre === 'kiosk' || clsOf(k) === 'tree'))];
      let cp: { p: Placed; x: number } | null = null, used = ck;
      for (const k of pieces) {
        cp = putClearOfDoors(sb, k, x0 - 3 * T, x0 + w + 3 * T, cxp, cyp + dyOf(k), clsOf(k), { gid, why: k === ck ? '广场的中心物，略偏上，前方留出空间' : `广场的中心物，略偏上，前方留出空间（抽到的 ${ck.split('/').pop()} 放在哪里都挡住后面楼的门，换小一点的）` });
        if (cp) { used = k; break; }
      }
      let half = 16;
      if (cp) {
        cxp = cp.x;
        if (clsOf(used) !== 'tree') half = (spr(used).bb[2] - spr(used).bb[0]) / 2;
      }
      const centreAnchor: Anchor = { kind: 'object', ref: `${gid}/centre`, x: cxp, y: cyp };
      // benches either side facing the centre with a cell of space between; on a narrow plaza one bench south of
      // the centre piece, facing it (back to the viewer)
      const off = Math.round(half + T + 8);
      if (cp && rr.choose('plaza.benches', {}, { p: 0.85 })) {
        const l = sb.putFoot(rr.choose('plaza.benchLeftModel', {}, [C + 'Bench_4', C + 'Bench_6']), cxp - off, cyp + 30, 'bench', { gid, why: '中心物左侧的长椅，面朝中心，隔一格（D21）', anchor: centreAnchor });
        const rgt = l && sb.putFoot(rr.choose('plaza.benchRightModel', {}, [C + 'Bench_3', C + 'Bench_5']), cxp + off, cyp + 30, 'bench', { gid, why: '中心物右侧的长椅，面朝中心，隔一格（D21）', anchor: centreAnchor });
        if (l && !rgt) { sb.objects.splice(sb.objects.indexOf(l), 1); sb.feet.pop(); }
        if (l && rgt) { if (rr.choose('plaza.sitter', {}, { p: 0.6 })) { const s = rr.choose('plaza.sitterLeft', {}, { p: 0.5 }) ? -1 : 1; person(sb, rr, cxp + s * off + (s < 0 ? 1 : -1), cyp + 18, 'sit', s < 0 ? 'right' : 'left', 'citizen', gid, '坐在长椅上面朝中心物的人'); } }
        else sb.putFoot(C + 'Bench_7', cxp, y1 - 3, 'bench', { gid, why: '广场太窄放不下两侧长椅：中心物南面一条背对观众、面朝中心的长椅', anchor: centreAnchor });
      }
      if (rr.choose('plaza.lamps', {}, { p: 0.5 })) for (const s of [-1, 1]) sb.putFoot(rr.choose('plaza.lampModel', {}, variants(C + 'Street_Lamp', [5])), cxp + s * (off + 20), cyp + 30, 'street_lamp', { gid, why: '长椅外侧对称的一对广场灯', anchor: centreAnchor });
      const nP = rr.count('plaza.people', {}, 1, 3);
      for (let i = 0, k = 0; i < 10 && k < nP; i++) if (person(sb, rr, cxp + rr.int(-w / 2 + 10, w / 2 - 10), rr.int(y0 + 18, y1 - 2), rr.choose('plaza.personPose', {}, ['stand', 'phone', 'walk'] as const), rr.choose('plaza.personDir', {}, ['down', 'left', 'right', 'up'] as const), 'citizen', gid, '在广场上走动或停留的人', rr.choose('plaza.kid', {}, { p: 0.2 }))) k++;
    } else if (z.kind === 'pocket') {
      const what = rr.choose('pocket.what', {}, { weights: [['tree', 3], ['bench', 2], ['phone', 1], ['bins', 1]] as const });
      const cxp = x0 + w / 2, fy = y1 - 6;
      if (what === 'tree') sb.putFoot(rr.choose('pocket.treeModel', {}, [C + 'Tree_1', C + 'Tree_8', C + 'Tree_13']), cxp, fy, 'tree', { gid });
      if (what === 'bench') sb.putFoot(C + 'Bench_1', cxp, fy, 'bench', { gid });
      if (what === 'phone') sb.putFoot(rr.choose('pocket.phoneModel', {}, variants(C + 'Phone_Booth')), cxp, fy, 'utility', { gid });
      if (what === 'bins') for (let i = 0; i < 2; i++) sb.putFoot(rr.choose('pocket.binModel', {}, variants(C + 'Trashbin')), cxp - 8 + i * 16, fy, 'trash', { gid });
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
  for (const b of neigh.buildings) for (let y = b.cy + b.plan.h - b.plan.foot; y < b.cy + b.plan.h; y++) for (let x = b.cx; x < b.cx + b.plan.w; x++) {
    const g = L.region[y]?.[x]; if (g !== undefined && g >= 0) hasBuilding.add(g);
  }
  for (const [g, cs] of cells) {
    if (hasBuilding.has(g) || cs.length > 260) continue;
    const xs = cs.map(c => c[0]), ys = cs.map(c => c[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs) + 1, y0 = Math.min(...ys), y1 = Math.max(...ys) + 1;
    if (x0 === 0 || y0 === 0 || x1 === L.cols || y1 === L.rows) continue;   // only fully visible islands
    const rr = sb.enter(r.fork(`island${g}`, { region: g, cells: cs.length }));
    islandSquare(L, sb, rr, { x0, y0, x1, y1 }, cs.filter(([x, y]) => L.cls[y][x] === 'nlot'), `region${g}`,
      `小岛街区（缺角处被环路围出的小地块，${cs.length} 格，放不下楼）：做成小广场`);
  }
}

/** one island block (cells x0..x1, y0..y1 with its sidewalk; `lot` = its lot cells) made a little public square: paving,
 *  a centre piece, trees either side, a bench, people. Everything but the centre piece stands on the lot, off the
 *  sidewalk's walkway (0.8.1-hotfix1: on the sidewalk C15 deleted them). The centre piece is the island's reason: when
 *  the drawn one does not fit, the other kiosks, then a small tree (482260: a bare island) */
export function islandSquare(L: Layout, sb: SceneBuilder, rr: Rng, box: { x0: number; y0: number; x1: number; y1: number }, lot: [number, number][], ref: string, why: string) {
  const { x0, y0, x1, y1 } = box;
  const cx = (x0 + x1) / 2 * T, cy = (y0 + y1) / 2 * T;
  const gid = sb.group('island', why, { anchor: { kind: 'block', ref, x: cx, y: cy } });
  sb.zone('block', 'island', rect(x0 * T, y0 * T, x1 * T, y1 * T), why, gid);
  const paving = rr.choose('island.paving', {}, ['sidewalk_beige', 'sidewalk_brown', 'sidewalk_lightbeige']);
  for (const [x, y] of lot) L.base[y][x] = slab(paving, x, y);
  const lx0 = Math.min(...lot.map(c => c[0])), lx1 = Math.max(...lot.map(c => c[0])) + 1, ly1 = Math.max(...lot.map(c => c[1])) + 1;
  const centre = rr.choose('island.centre', {}, { weights: [['kiosk', 2], ['fountain', 1], ['billboard', 1], ['tree', 1]] as const });
  const cw = '小广场的中心物';
  // the kiosks that fit the island: narrower than it by a cell. Tall is fine: it may rise over the road behind (862872
  // L1, good: the giant ice-cream kiosk on its island)
  const kiosks = [C + 'Kiosk_Infopoint_1', C + 'Kiosk_Coffee_Cup', C + 'Kiosk_Icecream', C + 'Kiosk_Mushroom'].filter(hasSprite)
    .filter(k => spr(k).bb[2] - spr(k).bb[0] <= (x1 - x0 - 1) * T);
  let put: Placed | null = null;
  if (centre === 'kiosk' && kiosks.length) { const k = rr.choose('island.kioskModel', {}, kiosks); put = sb.putFoot(k, cx, cy + 22, 'kiosk', { gid, why: cw, ignoreClear: true });
    for (const k2 of kiosks) if (!put && k2 !== k) put = sb.putFoot(k2, cx, cy + 22, 'kiosk', { gid, why: `${cw}（抽到的${k.split('/').pop()}放不下，换一个）`, ignoreClear: true }); }
  if (centre === 'fountain') put = sb.putFoot(rr.choose('island.fountainModel', {}, variants(C + 'Fountain')), cx, cy + 14, 'utility', { gid, why: cw, ignoreClear: true });
  // billboard centred on the island (its picture, not its foot; user label 941983 L3)
  if (centre === 'billboard') { const k = rr.choose('island.billboardModel', {}, variants(C + 'Billboard', [2, 3, 5, 6, 7, 8])); put = sb.putFoot(k, cx, cy + Math.round((spr(k).bb[3] - spr(k).bb[1]) / 2), 'info_sign', { gid, why: cw, ignoreClear: true }); }
  if (centre === 'tree') put = sb.putFoot(C + 'Tree_13', cx, cy + 16, 'tree', { gid, why: cw, ignoreClear: ['walkway'] });
  if (!put) sb.putFoot(C + 'Tree_1', cx, cy + 12, 'tree', { gid, why: `${cw}（抽到的放不下，换成一棵小树）`, ignoreClear: true });
  // the side trees at the lot's edges (a lot 5 cells wide at least), the bench on its bottom row
  for (const sx of [-1, 1]) if (lx1 - lx0 >= 5 && rr.choose('island.sideTree', {}, { p: 0.7 })) sb.putFoot(rr.choose('island.sideTreeModel', {}, [C + 'Tree_11', C + 'Tree_13']), cx + sx * ((lx1 - lx0) / 2 - 1) * T, cy + rr.int(-8, 16), 'tree', { gid, why: '小广场两侧的树，局部对称', ignoreClear: ['walkway'] });
  if (rr.choose('island.bench', {}, { p: 0.7 })) sb.putFoot(C + 'Bench_2', cx + rr.int(-20, 20), ly1 * T - 3, 'bench', { gid, why: '小广场南边的长椅，面朝观众一侧的街道', ignoreClear: ['walkway'] });
  for (let i = 0; i < rr.count('island.people', {}, 1, 3); i++) {
    const p = makePerson(rr, 'citizen');
    sb.putChar(p.layers, frameFor(p, rr.choose('island.personPose', {}, ['stand', 'phone', 'walk'] as const), rr.choose('island.personDir', {}, ['down', 'left', 'right', 'up'] as const), rr), cx + rr.int(-30, 30), cy + rr.int(-10, 30), 'citizen', { gid, why: '在小广场上的人' });
  }
}

// ------------------------------------------------------------------------------------------------
// bus stop, parked & driving cars, road details

export function busStop(L: Layout, sb: SceneBuilder, r: Rng, runs: CurbRun[]) {
  const cand = runs.filter(u => u.main && u.side === 'S' && u.b - u.a >= 8 * T);
  if (!cand.length || !r.choose('bus.present', { candidates: cand.length }, { p: 0.75 })) return;
  // a spot where the whole stop (bin .. shelter .. sign) is clear of doors, crossings, alleys and driveways
  let run = cand[0], s = -1;
  for (let t = 0; t < 24 && s < 0; t++) {
    const u = r.choose('bus.runTry', {}, cand), p = r.int(u.a + 4 * T, u.b - 5 * T);
    if (sb.free(rect(p - 60, u.fixed - 30, p + 64, u.fixed + 2), { ignoreClear: ['walkway'] })) { run = u; s = p; }
  }
  if (s < 0) return;
  const fy = run.fixed + 1;
  const gid = sb.group('bus', `公交站：主街区南侧够长（≥8 格）的路段上，避开门、横道、巷口和车道口（${run.id}）`, { anchor: curbAnchor(run, s) });
  const shelterKey = r.choose('bus.shelterModel', {}, [V + 'Bus_Stop_1', V + 'Bus_Stop_2']);
  const sh = sb.putFoot(shelterKey, s, fy - 2, 'bus_stop', { gid, why: '候车亭，背靠人行道、面朝马路', ignoreClear: ['walkway'] });
  if (!sh) return;
  sb.putFoot(r.choose('bus.signModel', {}, variants(V + 'Bus_Stop_Sign')), s + 52, fy, 'bus_stop', { gid, why: '站牌，立在候车亭旁的路缘', ignoreClear: ['walkway'] });
  sb.clear(rect(s - 56, fy - 30, s + 64, fy + 6), 'bus stop', '公交站台：候车和上下车的地方保持畅通', gid);
  if (r.choose('bus.sitter', {}, { p: 0.8 })) person(sb, r, s - 14 + r.int(0, 20), fy - 10, 'sit', r.choose('bus.sitterDir', {}, ['left', 'right'] as const), 'waiting', gid, '坐在候车亭里等车的人');
  for (let i = 0; i < r.count('bus.standing', {}, 0, 2); i++) person(sb, r, s + r.int(-50, 70), fy - r.int(2, 8), r.choose('bus.standingPose', {}, { p: 0.5 }) ? 'stand' : 'phone', 'down', 'waiting', gid, '站在路缘等车的人，面朝马路');
  sb.putFoot(r.choose('bus.binModel', {}, variants(C + 'Trashbin')), s - 52, fy - 4, 'trash', { gid, why: '候车亭旁的垃圾桶', ignoreClear: ['bus stop', 'walkway'] });
}

const carKeys = (dir: string, wide: boolean) => variants(V + `Car_${dir}`).filter(k => wide ? spr(k).w >= 64 : spr(k).h >= 64);

const segAnchor = (sg: Seg, i: number, p: number): Anchor => sg.axis === 'h'
  ? { kind: 'road', ref: `seg${i}`, x: p, y: (sg.band0 + sg.band1) / 2 * T } : { kind: 'road', ref: `seg${i}`, x: (sg.band0 + sg.band1) / 2 * T, y: p };

export function cars(L: Layout, sb: SceneBuilder, r: Rng, runs: CurbRun[]) {
  // parked: in the lane next to the curb, facing the lane's traffic direction (right-hand traffic)
  for (const run of runs) {
    const rr = sb.enter(r.fork(`cars${runLabel(L, run)}`, { run: run.id, side: run.side, main: run.main, len: Math.round((run.b - run.a) / T) }));
    if (!rr.choose('cars.parked', { main: run.main }, { p: run.main ? 0.55 : 0.35 }) || run.b - run.a < 8 * T) continue;
    const horiz = run.side === 'S' || run.side === 'N';
    const n = rr.count('cars.parkedCount', {}, 1, 3);
    const gid = sb.group('parked', `路边停车：${runName(run)} 靠路缘的车道，顺着右行方向`, { id: run.id, anchor: curbAnchor(run) });
    let s = run.a + rr.int(2 * T, Math.max(2 * T, (run.b - run.a) / 3));
    for (let i = 0; i < n && s < run.b - 5 * T; i++) {
      if (horiz) {
        const dir = run.side === 'S' ? 'Right' : 'Left';
        const key = rr.choose('cars.model', { dir }, carKeys(dir, true));
        const fy = run.side === 'S' ? run.curb + 30 : run.curb - 3;     // car body in the lane next to the curb
        const p = sb.putFoot(key, s + 32, fy, 'vehicle', { gid, why: '停在路缘的车，车头朝行驶方向', anchor: curbAnchor(run, s + 32), depth: 22 });
        if (p && rr.choose('cars.meter', {}, { p: 0.35 })) sb.putFoot(C + 'Parking_Meter_1', s + 8, run.side === 'S' ? run.curb - 3 : run.curb + 14, 'utility', { gid, why: '停车位旁路缘上的咪表', anchor: curbAnchor(run, s + 8) });
        s += 80 + rr.int(0, 3) * 16;
      } else {
        const dir = run.side === 'E' ? 'Down' : 'Up';
        const key = rr.choose('cars.model', { dir }, carKeys(dir, false));
        const fx = run.side === 'E' ? run.curb + 16 : run.curb - 16;
        sb.putFoot(key, fx, s + 60, 'vehicle', { gid, why: '停在路缘的车，车头朝行驶方向', anchor: curbAnchor(run, s + 60), depth: 50 });
        s += 80 + rr.int(0, 3) * 16;
      }
    }
  }
  // a couple of driving cars in random corridor lanes
  sb.enter(r);
  for (let i = 0; i < r.count('cars.driving', {}, 0, 2); i++) {
    const sg = r.choose('cars.drivingSeg', {}, L.segs);
    if (!sg || sg.b - sg.a < 8) continue;
    const si = L.segs.indexOf(sg);
    const p = r.int(sg.a + 1, sg.b - 5) * T;
    const half = (sg.band1 - sg.band0) / 2;
    const gid = sb.group('traffic', `行驶中的车：在路段 seg${si} 的车道里（右行）`, { anchor: segAnchor(sg, si, p) });
    if (sg.axis === 'h') {
      const east = r.choose('cars.east', {}, { p: 0.5 });
      const lane = east ? sg.band0 + half + 1 : sg.band0 + half - 1;
      sb.putFoot(r.choose('cars.model', { dir: east ? 'Right' : 'Left' }, carKeys(east ? 'Right' : 'Left', true)), p, lane * T + (east ? 14 : 4), 'vehicle', { gid, why: `向${east ? '东' : '西'}行驶的车，在${east ? '南' : '北'}侧车道`, depth: 22 });
    } else {
      const south = r.choose('cars.south', {}, { p: 0.5 });
      const lane = south ? sg.band0 + half - 1 : sg.band0 + half + 1;
      sb.putFoot(r.choose('cars.model', { dir: south ? 'Down' : 'Up' }, carKeys(south ? 'Down' : 'Up', false)), lane * T + 2, p, 'vehicle', { gid, why: `向${south ? '南' : '北'}行驶的车，在${south ? '西' : '东'}侧车道`, depth: 50 });
    }
  }
}

export function roadDetails(L: Layout, sb: SceneBuilder, r: Rng) {
  const manholes = variants(C + 'Manhole', [1, 2, 3, 4, 5]);
  for (const [si, sg] of L.segs.entries()) {
    if (sg.b - sg.a < 10 || !r.choose('road.manhole', { len: sg.b - sg.a }, { p: 0.4 })) continue;
    // one manhole, centred in a lane (lanes are either side of the centre line)
    const half = Math.floor((sg.band1 - sg.band0) / 2);
    const lane = sg.band0 + (r.choose('road.manholeLane', {}, { p: 0.5 }) ? Math.max(1, half - 1) : Math.min(sg.band1 - sg.band0 - 2, half + 1));
    const p = r.int(sg.a + 3, sg.b - 4) * T + 8, q = lane * T + 12;
    const [fx, fy] = sg.axis === 'h' ? [p, q] : [q - 4, p];
    const gid = sb.group('manhole', `井盖：较长（≥10 格）的路段 seg${si} 上至多一个（40%），在车道正中`, { anchor: segAnchor(sg, si, sg.axis === 'h' ? fx : fy) });
    sb.putFoot(r.choose('road.manholeModel', {}, manholes), fx, fy, 'manhole', { gid, depth: 4 });
  }
  // road works (rare): hole + barriers + cones in a lane
  if (r.choose('road.works', {}, { p: 0.25 })) {
    const sg = r.choose('road.worksSeg', {}, L.segs.filter(s => s.b - s.a >= 10));
    if (sg) {
      const si = L.segs.indexOf(sg);
      const p = r.int(sg.a + 2, sg.b - 4) * T;
      const q = (sg.band0 + 1) * T + 8;
      const [fx, fy] = sg.axis === 'h' ? [p, q + 10] : [q, p];
      const gid = sb.group('works', `道路施工（25% 的地图有）：路段 seg${si} 的一条车道里`, { anchor: segAnchor(sg, si, sg.axis === 'h' ? fx : fy) });
      if (!sb.putFoot(r.choose('road.holeModel', {}, variants(C + 'Holes').filter(k => spr(k).w >= 32)), fx, fy, 'roadworks', { gid, why: '施工的坑', depth: 6, pad: 20 })) return;
      const hole: Anchor = { kind: 'object', ref: `${gid}/hole`, x: fx, y: fy };
      const cones = variants(C + 'Cone');
      for (const [ox, oy] of [[-24, -12], [24, -12], [-26, 10], [26, 10]]) if (r.choose('road.cone', {}, { p: 0.75 })) sb.putFoot(r.choose('road.coneModel', {}, cones), fx + ox, fy + oy, 'roadworks', { gid, why: '围住坑的锥桶', anchor: hole });
      if (r.choose('road.barrier', {}, { p: 0.7 })) sb.putFoot(r.choose('road.barrierModel', {}, variants(C + 'Traffic_Barrier')), fx, fy - 22, 'roadworks', { gid, why: '坑后方的路障', anchor: hole });
      if (r.choose('road.worker', {}, { p: 0.4 })) person(sb, r, fx + 30, fy + 2, 'stand', 'left', 'worker', gid, '施工工人，面朝坑');
    }
  }
}

export function walkers(L: Layout, sb: SceneBuilder, r: Rng, runs: CurbRun[]) {
  // a few pedestrians on the sidewalks, between the facade and the curb strip
  for (const run of runs) {
    if (!r.choose('walk.run', { main: run.main }, { p: run.main ? 0.75 : 0.4 })) continue;
    const n = Math.max(0, Math.round((run.b - run.a) / (run.main ? 150 : 300)) + r.int(-1, 1));
    const gid = sb.group('walkers', `${runName(run)} 上的行人（约每 ${run.main ? 150 : 300}px 一个）`, { id: run.id, anchor: curbAnchor(run) });
    for (let i = 0; i < n; i++) {
      const s = r.int(run.a + 8, run.b - 8);
      const horiz = run.side === 'S' || run.side === 'N';
      const off = run.side === 'S' ? -14 : run.side === 'N' ? 14 : run.side === 'E' ? -12 : 12;
      const [fx, fy] = horiz ? [s, run.fixed + off] : [run.fixed + off, s];
      const dir: Dir = horiz ? r.choose('walk.dir', { horiz }, ['left', 'right'] as const) : r.choose('walk.dir', { horiz }, ['up', 'down'] as const);
      person(sb, r, fx, fy, r.choose('walk.pose', {}, { weights: [['walk', 5], ['phone', 1], ['stand', 1]] as const }), dir, 'citizen', gid, '沿人行道通行带走路的行人', r.choose('walk.kid', {}, { p: 0.08 }));
    }
  }
}

export { type PlacedBuilding };
