// v0.8.2: the centre of a big city block (spec 3.3). A big plain rect block keeps its middle for a plaza (garden in
// residential areas): the lot is inset (south more, for the frontage row and its yard), and passages 2-3 cells wide
// lead to it from the south frontage and from one other side. Carved before packing (planMainBlock), so no building
// stands on it; the yard does not get its cells.
import type { Rng } from './rng';
import type { Layout } from './layout';
import { slab } from './layout';
import type { BlockPlan, Zone } from './block';
import { SceneBuilder, rect } from './place';
import { lawn, SCHOOL_TOYS } from './district';
import { SMALL_TREES } from './yard';
import { cafeTables, hidesDoor, person, putClearOfDoors } from './vignettes';
import { spr, variants, hasSprite } from './assets';
import { TILE, type Anchor, type Placed, type Scene } from './types';
import { buildGraph } from './rational/graph';
import { worldFromScene } from './rational/world';

/** lot cells kept for buildings on each side */
export const CENTRE_INSET = { s: 14, n: 10, e: 10, w: 10 } as const;
/** rows a building south of the centre may reach into it with its upper floors (the rest stays in sight) */
export const CENTRE_OVERHANG = 3;
/** smaller: no centre */
export const CENTRE_MIN_AREA = { w: 12, h: 8 } as const;

/** cells, half-open */
export interface CentreArea { kind: 'plaza' | 'garden'; x0: number; y0: number; x1: number; y1: number; why: string }

const NAME = { plaza: '广场', garden: '中庭' } as const;

export function planCentre(lot: { bx0: number; by0: number; bx1: number; by1: number }, kind: 'plaza' | 'garden', r: Rng):
  { area: CentreArea; passages: Zone[] } | { note: string } {
  const x0 = lot.bx0 + CENTRE_INSET.w, y0 = lot.by0 + CENTRE_INSET.n, x1 = lot.bx1 - CENTRE_INSET.e, y1 = lot.by1 - CENTRE_INSET.s;
  const w = x1 - x0, h = y1 - y0;
  if (w < CENTRE_MIN_AREA.w || h < CENTRE_MIN_AREA.h)
    return { note: `中心区 ${w}×${h} 不足 ${CENTRE_MIN_AREA.w}×${CENTRE_MIN_AREA.h}，不刻` };
  const name = NAME[kind];
  const area: CentreArea = { kind, x0, y0, x1, y1,
    why: `大街区的中心${name}（地块内缩：南 ${CENTRE_INSET.s}、北 / 东 / 西 ${CENTRE_INSET.n} 格，${w}×${h}）` };
  const way = (from: string) => `通往中心${name}的通道（${from}）`;
  const s = r.int(2, 3), sx = r.int(x0 + 2, x1 - 2 - s);
  const south: Zone = { kind: 'alley', x0: sx, x1: sx + s, y0: y1, y1: lot.by1, why: way('从南侧临街面进'), toCentre: true };
  const side = r.choose('centre.side', {}, ['E', 'W', 'N'] as const), t = r.int(2, 3);
  let other: Zone;
  if (side === 'N') {
    const x = r.int(x0 + 2, x1 - 2 - t);
    other = { kind: 'alley', x0: x, x1: x + t, y0: lot.by0, y1: y0, why: way('从北侧人行道直下'), toCentre: true };
  } else {
    const y = r.int(y0 + 1, y1 - 1 - t);
    other = side === 'E'
      ? { kind: 'alley', x0: x1, x1: lot.bx1, y0: y, y1: y + t, why: way('从东侧人行道进'), toCentre: true }
      : { kind: 'alley', x0: lot.bx0, x1: x0, y0: y, y1: y + t, why: way('从西侧人行道进'), toCentre: true };
  }
  return { area, passages: [south, other] };
}

/** the centre's ground, zone, group and the passages kept clear, then what stands in it: a plaza gets a centre piece
 *  with benches facing it, a tree and flower bed in each corner, cafe tables before the north buildings' doors and
 *  people; a garden gets a cross path on from the passages, a playground corner, trees and benches beside the path,
 *  people and children (spec 3.3). Stream 'centre'; everything in the centre group */
export function centreVignettes(L: Layout, plan: BlockPlan, sb: SceneBuilder, r: Rng): void {
  const a = plan.centre;
  if (!a) return;
  if (a.kind === 'plaza') {
    for (let y = a.y0; y < a.y1; y++) for (let x = a.x0; x < a.x1; x++) L.base[y][x] = slab(L.mainStyle, x, y);
  } else lawn(L, a);
  const px = rect(a.x0 * T, a.y0 * T, a.x1 * T, a.y1 * T);
  const gid = sb.group('centre', a.why, { anchor: { kind: 'zone', ref: `centre@${a.x0},${a.y0}`, x: (a.x0 + a.x1) * T / 2, y: a.y1 * T } });
  sb.zone('block', 'centre', px, a.why, gid);
  // each passage, out onto the sidewalk at its street end and 2 cells into the centre at the other
  const passages = plan.zones.filter(q => q.toCentre);
  for (const z of passages) {
    let { x0, y0, x1, y1 } = z;
    if (z.y0 >= a.y1) { y1 += L.sw; y0 -= 2; }
    else if (z.y1 <= a.y0) { y0 -= L.sw; y1 += 2; }
    else if (z.x0 >= a.x1) { x1 += L.sw; x0 -= 2; }
    else { x0 -= L.sw; x1 += 2; }
    sb.clear(rect(x0 * T, y0 * T, x1 * T, y1 * T), 'alley', '通往中心的通道保持畅通', gid);
  }
  if (a.kind === 'plaza') plazaContents(plan, sb, r, a, gid);
  else gardenContents(L, sb, r, a, passages, gid);
}

const T = TILE, C = '3_City_Props/', G = '17_Garden/';

/** the centre piece, benches facing it, corner trees with flower beds, cafe tables, people */
function plazaContents(plan: BlockPlan, sb: SceneBuilder, r: Rng, a: CentreArea, gid: string) {
  const X0 = a.x0 * T, X1 = a.x1 * T, Y0 = a.y0 * T, Y1 = a.y1 * T, w = a.x1 - a.x0;
  const head = '大街区的中心广场';
  // the middle of the part in sight: buildings south of the centre may cover its last CENTRE_OVERHANG rows
  const Yv = (a.y1 - CENTRE_OVERHANG) * T, cx = (X0 + X1) / 2, cy = (Y0 + Yv) / 2;
  const width = (k: string) => spr(k).bb[2] - spr(k).bb[0];
  const fountains = [...variants(C + 'Fountain'), G + 'Fountain_1_1', G + 'Fountain_2_1', G + 'Fountain_3_1'].filter(hasSprite);
  const statues = [G + 'Angel_Statue_1', G + 'Angel_Statue_2', G + 'Grey_Statue', G + 'Light_Brown_Statue'].filter(hasSprite);
  const pergola = G + 'Pergola_Example';
  const piece = r.choose('centre.piece', {}, { weights: [['fountain', 3], ['statue', 2], ['pavilion', 1]] as const });
  // the pergola only on a plaza at least 4 cells wider than it, else a kiosk
  const ck = piece === 'fountain' ? r.choose('centre.fountainModel', {}, fountains)
    : piece === 'statue' ? r.choose('centre.statueModel', {}, statues)
    : hasSprite(pergola) && width(pergola) <= (w - 4) * T ? pergola
    : r.choose('centre.kioskModel', {}, [C + 'Kiosk_Infopoint_1', C + 'Kiosk_Coffee_Cup'].filter(hasSprite));
  const kindOf = (k: string) => k.includes('Fountain') ? '喷泉' : k.includes('Statue') ? '雕像' : '亭子';
  const dyOf = (k: string) => kindOf(k) === '亭子' ? 20 : 12;
  const clsOf = (k: string) => kindOf(k) === '亭子' ? 'kiosk' : 'utility';
  // as in zoneVignettes (D89): where it hides no door, else a smaller piece (the fountains and statues no wider,
  // widest first), else no centre piece and no benches facing it
  const pieces = [ck, ...[...fountains, ...statues].filter(k => k !== ck && width(k) <= width(ck)).sort((p, q) => width(q) - width(p))];
  let cp: { p: Placed; x: number } | null = null, used = ck;
  for (const k of pieces) {
    const why = `${head}：正中的中心物（${kindOf(k)}）`;
    cp = putClearOfDoors(sb, k, X0, X1, cx, cy + dyOf(k), clsOf(k), { gid, why: k === ck ? why : `${why}（抽到的 ${ck.split('/').pop()} 放在哪里都挡门或放不下，换小一点的）` });
    if (cp) { used = k; break; }
  }
  if (cp) {
    // benches either side facing it, a cell of space between (D21); not both: one south of it, facing it
    const cxp = cp.x, off = Math.round(width(used) / 2 + T + 8), by = cy + 30;
    const anchor: Anchor = { kind: 'object', ref: `${gid}/centre`, x: cxp, y: cy };
    const l = sb.putFoot(r.choose('centre.benchLeftModel', {}, [C + 'Bench_4', C + 'Bench_6']), cxp - off, by, 'bench', { gid, why: `${head}：中心物左侧的长椅，面朝中心，隔一格（D21）`, anchor });
    const rgt = l && sb.putFoot(r.choose('centre.benchRightModel', {}, [C + 'Bench_3', C + 'Bench_5']), cxp + off, by, 'bench', { gid, why: `${head}：中心物右侧的长椅，面朝中心，隔一格（D21）`, anchor });
    if (l && !rgt) { sb.objects.splice(sb.objects.indexOf(l), 1); sb.feet.pop(); }
    if (!l || !rgt) sb.putFoot(C + 'Bench_7', cxp, Yv - 3, 'bench', { gid, why: `${head}：两侧放不下长椅，中心物南面一条背对观众、面朝中心的长椅`, anchor });
  }
  // a tree in each corner, a cell in, with a flower bed on its inner side; off the doors (D89), moved toward the middle
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const key = r.choose('centre.treeModel', {}, [C + 'Tree_11', C + 'Tree_13']), hw = width(key) / 2;
    const fx = sx < 0 ? X0 + T + hw : X1 - T - hw, fy = sy < 0 ? Y0 + 3 * T : Y1 - T;
    const t = putClearOfDoors(sb, key, sx < 0 ? X0 : cx, sx < 0 ? cx : X1, fx, fy, 'tree', { gid, why: `${head}：四角（内缩一格）的树` });
    if (t) sb.putFoot(r.choose('centre.flowerModel', {}, variants(C + 'Flower_Bush', [1, 2, 3])), t.x - sx * (hw + 18), fy, 'plant', { gid, why: `${head}：角上树旁的花坛` });
  }
  // cafe tables before the doors of the north buildings that open straight onto the plaza: the facade's bottom row
  // is the row above it (a building set back behind a yard strip gets none); the tables hug the facade as in frontOf
  for (const pb of plan.buildings) {
    const b = pb.plan, left = pb.cx * T, dx = left + (b.doors[0] ?? b.w * T / 2), bottom = pb.cy + b.h;
    if (pb.side !== 'N' || bottom !== a.y0 || dx < X0 || dx >= X1) continue;
    const x0 = Math.max(left, X0);
    if (x0 + 100 > X1 || !r.choose('centre.cafe', {}, { p: 0.5 })) continue;
    const rr = r.fork(`cafe${b.id}`);
    sb.inStream(rr.stream, () => cafeTables(sb, rr, gid, x0, dx, bottom * T + 20));
  }
  people(sb, r, a, gid, `${head}：在广场上走动或停留的人`);
}

/** the cross path, a playground corner, trees on the lawn, benches beside the path, people and children */
function gardenContents(L: Layout, sb: SceneBuilder, r: Rng, a: CentreArea, passages: Zone[], gid: string) {
  const head = '大街区的中心中庭';
  const W = a.x1 - a.x0, H = a.y1 - a.y0;
  // the path: each passage carried on through the centre to the far side, as wide as it; a south and a north one
  // joined by a cross path 2 rows high in the middle
  const paths = passages.map(z => z.x0 >= a.x0 && z.x1 <= a.x1
    ? { vertical: true, x0: z.x0, y0: a.y0, x1: z.x1, y1: a.y1 } : { vertical: false, x0: a.x0, y0: z.y0, x1: a.x1, y1: z.y1 });
  if (paths.length >= 2 && paths.every(q => q.vertical)) {
    const ym = Math.floor((a.y0 + a.y1) / 2) - 1;
    paths.push({ vertical: false, x0: Math.min(...paths.map(q => q.x0)), y0: ym, x1: Math.max(...paths.map(q => q.x1)), y1: ym + 2 });
  }
  const onPath = (x: number, y: number) => paths.some(q => x >= q.x0 && x < q.x1 && y >= q.y0 && y < q.y1);
  for (const q of paths) {
    for (let y = q.y0; y < q.y1; y++) for (let x = q.x0; x < q.x1; x++) { L.over[y][x] = null; L.base[y][x] = slab(L.mainStyle, x, y); }
    sb.clear(rect(q.x0 * T, q.y0 * T, q.x1 * T, q.y1 * T), 'path', `${head}：十字小路，两端接通往中心的通道，保持畅通`, gid);
  }
  // the lawn's edge tiles follow the path
  const grassAt = (x: number, y: number) => x >= a.x0 && x < a.x1 && y >= a.y0 && y < a.y1 && !onPath(x, y);
  for (let y = a.y0; y < a.y1; y++) for (let x = a.x0; x < a.x1; x++) if (grassAt(x, y))
    L.over[y][x] = ['terr', grassAt(x - 1, y) ? (grassAt(x + 1, y) ? 1 : 2) : 0, grassAt(x, y - 1) ? (grassAt(x, y + 1) ? 12 : 13) : 11];
  // the playground: a corner clear of the path and so of the passages' mouths (none: any corner; the path's
  // keep-clear keeps the toys off it)
  const pw = Math.min(8, Math.floor((W - 2) / 2)), ph = Math.min(6, Math.floor((H - 2) / 2));
  const cornerRect = (c: string) => { const x0 = c.includes('W') ? a.x0 : a.x1 - pw, y0 = c.includes('N') ? a.y0 : a.y1 - ph; return { x0, y0, x1: x0 + pw, y1: y0 + ph }; };
  const clearOfPath = (c: string) => { const q = cornerRect(c); for (let y = q.y0; y < q.y1; y++) for (let x = q.x0; x < q.x1; x++) if (onPath(x, y)) return false; return true; };
  // the north corners first: the south ones lie partly behind the buildings south of the centre (CENTRE_OVERHANG)
  const corners = ['NW', 'NE', 'SW', 'SE'], free = corners.filter(clearOfPath), north = free.filter(c => c.includes('N'));
  const pc = cornerRect(r.choose('centre.playCorner', {}, north.length ? north : free.length ? free : corners));
  const pr = rect(pc.x0 * T, pc.y0 * T, pc.x1 * T, pc.y1 * T);
  // 3-5 toys, each kind once, 6 px apart; the ones no wider than half the corner when there are 3 such kinds
  const fits = (f: number) => SCHOOL_TOYS.filter(k => spr(k).bb[2] - spr(k).bb[0] <= (pr.x1 - pr.x0) * f - 4);
  const toys = fits(0.5).length >= 3 ? fits(0.5) : fits(1);
  const nToys = r.count('centre.toys', {}, 3, 5);
  for (let i = 0, k = 0; i < 10 * nToys && k < nToys && toys.length; i++) {
    const key = r.choose('centre.toyModel', {}, toys), sp = spr(key), hw = (sp.bb[2] - sp.bb[0]) / 2, hh = sp.bb[3] - sp.bb[1];
    const fx = r.int(Math.ceil(pr.x0 + hw + 2), Math.floor(pr.x1 - hw - 2)), fy = r.int(Math.ceil(pr.y0 + Math.min(hh, pr.y1 - pr.y0 - 4)), pr.y1 - 2);
    if (hidesDoor(sb, key, fx, fy)) continue;
    if (sb.putFoot(key, fx, fy, 'playground', { gid, why: `${head}：一角的儿童游乐设施（学校游乐场的素材）`, depth: Math.min(hh, 20), pad: 6 })) { k++; toys.splice(toys.indexOf(key), 1); }
  }
  for (let i = 0, k = 0, n = r.count('centre.kids', {}, 2, 4); i < 10 && k < n; i++)
    if (person(sb, r, r.int(pr.x0 + 8, pr.x1 - 8), r.int(pr.y0 + 16, pr.y1 - 2), r.choose('centre.kidPose', {}, ['stand', 'walk'] as const), r.choose('centre.kidDir', {}, ['down', 'left', 'right', 'up'] as const), 'kid', gid, `${head}：在游乐角玩的孩子`, true)) k++;
  // benches beside the path, facing it (before the trees: they need the path's edge)
  for (let i = 0, k = 0, n = r.count('centre.benches', {}, 2, 4); i < 4 * n && k < n; i++) {
    const q = r.choose('centre.benchPath', {}, paths), before = r.choose('centre.benchSide', {}, { p: 0.5 });
    const o = { gid, why: `${head}：小路旁的长椅，面朝小路（D21）`, anchor: { kind: 'yard', ref: `${gid}/path`, x: (q.x0 + q.x1) * T / 2, y: (q.y0 + q.y1) * T / 2 } as Anchor };
    if (q.vertical) {
      const by = r.int(q.y0 + 2, q.y1 - 1) * T - 4;
      const key = before ? r.choose('centre.benchModel', { faces: 'right' }, [C + 'Bench_4', C + 'Bench_6']) : r.choose('centre.benchModel', { faces: 'left' }, [C + 'Bench_3', C + 'Bench_5']);
      if (sb.putFoot(key, before ? q.x0 * T - 8 : q.x1 * T + 8, by, 'bench', o)) k++;
    } else {
      const bx = (r.int(q.x0 + 1, q.x1 - 2) + 0.5) * T;
      if (before ? sb.putFoot(r.choose('centre.benchModel', { faces: 'down' }, [C + 'Bench_1', C + 'Bench_2']), bx, q.y0 * T - 1, 'bench', o)
        : q.y1 + 2 <= a.y1 && sb.putFoot(C + 'Bench_7', bx, q.y1 * T + 30, 'bench', o)) k++;
    }
  }
  // trees on the lawn: not on the path, not in the playground, hiding no door (D89)
  const trees = SMALL_TREES.filter(hasSprite);
  for (let i = 0, k = 0, n = r.count('centre.trees', {}, 3, 6); i < 4 * n && k < n; i++) {
    const key = r.choose('centre.treeModel', {}, trees), x = r.int(a.x0, a.x1 - 1), y = r.int(a.y0 + 1, a.y1 - 1);
    if (!grassAt(x, y) || (x >= pc.x0 && x < pc.x1 && y >= pc.y0 && y < pc.y1)) continue;
    const fx = (x + 0.5) * T, fy = (y + 1) * T - 3;
    if (!hidesDoor(sb, key, fx, fy) && sb.putFoot(key, fx, fy, 'tree', { gid, why: `${head}：草坪上的小树`, pad: 6 })) k++;
  }
  people(sb, r, a, gid, `${head}：在中庭里散步或停留的人`);
}

/** 2-5 people somewhere in the centre */
function people(sb: SceneBuilder, r: Rng, a: CentreArea, gid: string, why: string) {
  for (let i = 0, k = 0, n = r.count('centre.people', {}, 2, 5); i < 10 && k < n; i++)
    if (person(sb, r, r.int(a.x0 * T + 10, a.x1 * T - 10), r.int(a.y0 * T + 18, a.y1 * T - 2), r.choose('centre.personPose', {}, ['stand', 'phone', 'walk'] as const),
      r.choose('centre.personDir', {}, ['down', 'left', 'right', 'up'] as const), 'citizen', gid, why)) k++;
}

/** the 'centre' zone's place has a walkable component rooted at the street */
export function centreReachable(sc: Scene): boolean {
  const g = buildGraph(worldFromScene(sc));
  const place = g.places.find(p => p.kind === 'centre');
  return !!place && [...place.comps].some(c => g.compRoots[c].has('street'));
}
