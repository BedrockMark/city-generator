// exp-09 宫殿花园 (palace garden, v0.7.9; adopted in 0.7.9.1, untagged, still menu-only): the special district built round 17_Garden/Palace_Example_1/2 (ref garden,
// garden_warmhouse, different_swimming_pools, playground_for_kids).
// User 2026-11-08: the palace has its own modular pieces (the entrance porches); a garden runs round the back of it with a
// greenhouse in it and the garden walls (hedges) used; in front a drop-off area, and outside the drive a lawn or a fountain
// plaza. Second round (same day): the first layout is one possibility, not the rule; the estate is the size of 2-3
// ordinary blocks; symmetry may break; the back garden may be much bigger and hold a pool, a playground, a hedge maze, a
// big greenhouse (each seed some of them); no fixed one-cell-after-another pattern (enclosed areas are fine); the walks
// and the drop-off stay as they are.
//
// North to south: back garden | palace (the whole 25 x 29 sprite on the lot; its stair runs 5 rows further south) with
// planted beds either side of the stair | the drop-off lane at the stair's foot | two driveway legs down to the street
// with the front lawn / fountain plaza between them. The garden is a U round the palace: a tall hedge (Grass_Wall_2, the
// garden wall) on its outer edge, a 2-cell walk round the palace (behind it right across the garden). The ground between
// is cut up at random: paths (2 cells) cut each part in two, starting from the walk or another path, so every piece
// borders one; the pieces become the seed's features (pool, maze, playground, big greenhouse), hedged rooms (low hedge
// Grass_Wall_1, opening onto the path at a random place), informal lawns with trees, the gardener's shed. Some seeds keep
// the garden symmetric about the palace's axis (mirrored pieces, a court or an axis path behind the palace).
//
// Random numbers: the plan on stream `landmark`
// (as every district), the grounds on `district/palace` (layout attempts on its sub-streams `try<n>`).
import { Rng } from './rng';
import { spr, variants, hasSprite } from './assets';
import { slab, asphalt, type Layout } from './layout';
import type { BuildingPlan } from './buildings';
import { SceneBuilder, rect } from './place';
import { person } from './vignettes';
import { TILE } from './types';
import { driveway, type Campus, type Feat, type Landmark } from './district';

const T = TILE;
const G = '17_Garden/';
const P = '14_Swimming_Pool/';

/** read off Palace_Example_1/2 (cells): the building is the top 29 rows, the stair columns 9-15 run to row 34; the
 *  entrance porch (Palace_<n>_Entrance_Variant_1-3, 7 x 4) sits at (144, 400) px, the door in its middle */
const PW = 25, PH = 29, SX0 = 9, SX1 = 16, STAIR = 5, AXIS = 12.5, LANE = 4, WALK = 2;

/** the palace's plan: the sprite, its porch and, sometimes, the porch's open doors (Variant_4: top half for the plain /
 *  two-column porches, bottom half for the four-column one) */
export function palacePlan(r: Rng, id: string): BuildingPlan {
  const n = r.choose('palace.model', {}, [1, 2]);
  const porch = r.choose('palace.porch', { model: n }, [1, 2, 3]);
  const porchKey = `${G}Palace_${n}_Entrance_Variant_${porch}`;
  const parts: BuildingPlan['parts'] = [
    { key: `${G}Palace_Example_${n}`, dx: 0, dy: 0, sub: 0, role: 'whole' },
    { key: porchKey, dx: 144, dy: 400, sub: 1, role: 'entrance' },
  ];
  if (r.choose('palace.open', {}, { p: 0.4 }))
    parts.push({ key: `${G}Palace_${n}_Entrance_Variant_4`, dx: 176, dy: 400, sub: 2, role: 'entrance', clip: porch === 2 ? [0, 32, 48, 64] : [0, 0, 48, 32] });
  return { id, w: PW, h: PH, foot: PH, parts, doors: [AXIS * T], front: 'landmark', tall: true,
    label: `宫殿（${porch === 1 ? '无柱' : porch === 2 ? '四柱' : '两柱'}门廊${parts.length > 2 ? '，大门敞开' : ''}）` };
}

/** the campus (block-local cells). User: about 2-3 ordinary blocks (an ordinary block's interior is ~550 cells; two or
 *  three of them with the roads between ~1700-2600). The proportions vary: a deep back garden, wide sides, one wide
 *  side, or balanced; the palace itself with its drop-off and front takes ~1100 of it */
export function palaceCampus(r: Rng, plan: BuildingPlan): Campus {
  const pd = r.int(5, 7);
  const core = PH + STAIR + LANE + pd;
  const A = r.int(1700, 2600);
  const shape = r.choose('palace.shape', {}, { weights: [['deep', 3], ['wide', 2], ['side', 2], ['balanced', 2]] as const });
  // every shape leaves at least one part big enough for a feature (a side >= 12 columns: 9 usable; a back >= 13 rows:
  // 9 usable); the rest of the area goes where the shape says
  const sym = shape !== 'side' && r.choose('palace.symmetric', { shape }, { p: 0.3 });
  const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
  let gn: number, gw: number, ge: number;
  if (shape === 'deep' || shape === 'balanced') {
    gn = shape === 'deep' ? r.int(16, 24) : r.int(13, 16);
    const S = clamp(Math.round(A / (core + gn)) - PW, 8, 30);
    if (sym) gw = ge = Math.ceil(S / 2);
    else { gw = Math.max(4, Math.round(S * r.int(25, 75) / 100)); ge = Math.max(4, S - gw); }
  } else if (shape === 'side') {
    const big = r.int(13, 20), small = r.int(4, 5);
    [gw, ge] = r.choose('palace.bigWest', {}, { p: 0.5 }) ? [big, small] : [small, big];
    gn = clamp(Math.round(A / (PW + big + small)) - core, 6, 14);
  } else {
    gw = r.int(12, 16); ge = sym ? gw : r.int(12, 16);
    gn = clamp(Math.round(A / (PW + gw + ge)) - core, 6, 10);
  }
  const front = r.choose('palace.front', {}, { weights: [['frontlawn', 1], ['fountain', 1]] as const });
  const W = gw + PW + ge, fy = gn + PH, sy = fy + STAIR, ly = sy + LANE, H = ly + pd;
  const why = '宫殿（exp-09 宫殿花园）：素材里的宫殿（25×34 格，带台阶），整栋立在地块上，后面和两边一圈是它的花园，前面是下车处';
  const feats: Feat[] = [
    // key 'mirror': the garden is laid out symmetrically about the palace's axis
    { kind: 'garden', x0: 0, y0: 0, x1: W, y1: H, key: sym ? 'mirror' : undefined, why: `宫殿的花园（${{ deep: '后花园很深', wide: '两侧花园宽', side: '一侧花园宽', balanced: '后面和两侧差不多' }[shape]}${sym ? '，左右对称' : ''}）：围着宫殿后面和两边，外沿是高树篱（花园墙），绕宫殿一圈的步道，中间随机分成几块：各有用途的功能区、树篱围起的小花园、草地（参考图 garden、garden_warmhouse）` },
    { kind: 'beds', x0: gw, y0: fy, x1: gw + PW, y1: sy, why: '宫殿台阶两侧的花坛：矮树篱围着，里面是花和盆栽' },
    { kind: 'dropoff', x0: gw, y0: sy, x1: gw + PW, y1: H, why: '下车处：台阶脚下的车道，车从一边的车道口开进来，在台阶前停下让客人下车，从另一边开出去' },
    { kind: front, x0: gw + 4, y0: ly, x1: gw + PW - 4, y1: H, why: front === 'fountain' ? '车道外的喷泉广场：两条车道之间、临街，中间是喷泉，从街上沿中轴走到宫殿台阶' : '车道外的草坪：两条车道之间、临街，矮树篱围着两块草坪，中间一条路沿中轴通到宫殿台阶' },
  ];
  return { kind: 'palace', W, H, items: [{ plan, x: gw, bottom: gn + PH - 1, side: 'N', why }], feats };
}

// ------------------------------------------------------------------------------------------------
// hedges: Grass_Wall_1 (low, 1 cell) and Grass_Wall_2 (tall, drawn 2 cells: the top on the hedge's line, the face below).
// Piece numbers read off the sheet (17_Garden_16x16.png cols 0-3 rows 0-3): 9 / 10 / 11 a run's left end / middle / right
// end, 1 / 3 / 7 / 5 the corners (top-left, top-right, bottom-left, bottom-right), vertical runs: low 12 / 13 / 14 (top,
// middle, bottom end), tall 13 / 8 / 12 (the tall set numbers its ends the other way). The pack has a cross (low 25) but
// no T: a T is the cross with the closed edge of a straight piece over its open side (a clipped strip of 10 or 13).
// Only the maze has junctions; the tall wall is one polyline.

type Sys = 'low' | 'tall';
const VERT: Record<Sys, [number, number, number]> = { low: [12, 13, 14], tall: [13, 8, 12] };
function piece(sys: Sys, n: boolean, e: boolean, s: boolean, w: boolean): number {
  const [top, mid, bot] = VERT[sys];
  if (e && w && !n && !s) return 10;
  if (n && s && !e && !w) return mid;
  if (e && !w && !n && !s) return 9;
  if (w && !e && !n && !s) return 11;
  if (s && !n && !e && !w) return top;
  if (n && !s && !e && !w) return bot;
  if (e && s) return 1;
  if (w && s) return 3;
  if (n && e) return 7;
  if (n && w) return 5;
  return 10;
}
/** low hedge junctions: [base piece, overlay piece, overlay px rect] */
function junction(n: boolean, e: boolean, s: boolean, w: boolean): [number, number | null, [number, number, number, number] | null] {
  if (n && e && s && w) return [25, null, null];
  if (!n) return [25, 10, [0, 0, 16, 6]];
  if (!s) return [10, 25, [0, 0, 16, 7]];
  if (!w) return [25, 13, [0, 0, 5, 16]];
  return [25, 13, [11, 0, 16, 16]];
}

/** a hedge on the given cells (one system: autotiled among themselves); `skip` = cells covered by a gate */
function hedge(sb: SceneBuilder, sys: Sys, cells: [number, number][], flowered: boolean, gid: string, why: string, skip = new Set<string>()) {
  const has = new Set(cells.map(([x, y]) => `${x},${y}`));
  const h = sys === 'tall' ? 2 : 1, set = sys === 'tall' ? 2 : 1;
  const key = (n: number) => { const k = `${G}Grass_Wall_${set}_${flowered ? 'Flowered_' : ''}${n}`; return hasSprite(k) ? k : `${G}Grass_Wall_${set}_${n}`; };
  for (const [x, y] of cells) {
    if (skip.has(`${x},${y}`)) continue;
    const n = has.has(`${x},${y - 1}`), e = has.has(`${x + 1},${y}`), s = has.has(`${x},${y + 1}`), w = has.has(`${x - 1},${y}`);
    if (sys === 'low' && +n + +e + +s + +w >= 3) {
      const [base, over, box] = junction(n, e, s, w);
      sb.putAt(`${G}Grass_Wall_1_${base}`, x * T, y * T, 'fence', { gid, why, force: true, occupy: false });
      if (over && box) sb.putAt(`${G}Grass_Wall_1_${over}`, x * T + box[0], y * T + box[1], 'fence', { gid, why, force: true, occupy: false, clip: box, foot: (y + 1) * T });
    } else sb.putAt(key(piece(sys, n, e, s, w)), x * T, y * T, 'fence', { gid, why, force: true, occupy: false });
    sb.occupy(rect(x * T, y * T, (x + 1) * T, (y + h) * T), 'fence');
  }
}

/** the border cells of a rect (cells, half-open) */
function ring(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const out: [number, number][] = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (x === x0 || x === x1 - 1 || y === y0 || y === y1 - 1) out.push([x, y]);
  return out;
}

// ------------------------------------------------------------------------------------------------
// the garden's layout: pieces cut by paths

type Side = 'N' | 'S' | 'E' | 'W';
/** a piece of the garden (cells, half-open); open = sides along a walk or path; wall = sides along the garden wall */
interface Piece { x0: number; y0: number; x1: number; y1: number; open: Side[]; wall: Side[]; twin?: number }
interface Box { x0: number; y0: number; x1: number; y1: number }
interface Cut { pieces: Piece[]; ways: Box[] }

const MIN = 5, WAY = 2;
const without = (a: Side[], s: Side) => a.filter(q => q !== s);
const flip: Record<Side, Side> = { N: 'N', S: 'S', E: 'W', W: 'E' };

/** cut a piece in two with a path from an open side (or back to back, both halves keeping that side), at random */
function cut(r: Rng, p: Piece, depth: number, out: Cut, want: Feature[]) {
  const w = p.x1 - p.x0, h = p.y1 - p.y0;
  const ns = p.open.includes('N') || p.open.includes('S'), ew = p.open.includes('E') || p.open.includes('W');
  const opts: [string, number][] = [];
  // the long side is cut far more often (a side strip should not stay one 40-row room)
  if (ns && w >= 2 * MIN + WAY) opts.push(['v', w * w]);
  if (ew && h >= 2 * MIN + WAY) opts.push(['h', h * h]);
  if (ns && w >= 2 * MIN + 1) opts.push(['vw', w * w / 4]);
  if (ew && h >= 2 * MIN + 1) opts.push(['hw', h * h / 4]);
  const area = w * h, long = Math.max(w, h);
  // a piece that would hold one of the seed's features (and is not much bigger) is mostly kept whole for it
  const host = want.some(f => fits(f, p) && area <= 3 * FEATURE_MIN[f][0] * FEATURE_MIN[f][1]);
  if (!opts.length || r.choose('palace.leaf', { depth, host }, { p: host ? 0.65 : long >= 16 ? 0.02 : area > 160 ? 0.3 : 0.6 })) { out.pieces.push(p); return; }
  const how = r.choose('palace.cut', { depth }, { weights: opts });
  // a path is a 2-cell walk or a 1-cell garden path
  const way = how.length === 1 ? r.choose('palace.wayW', { depth }, [1, WAY]) : 0;
  if (how[0] === 'v') {
    const x = r.int(p.x0 + MIN, p.x1 - MIN - way);
    if (way) out.ways.push({ x0: x, y0: p.y0, x1: x + way, y1: p.y1 });
    cut(r, { ...p, x1: x, open: way ? [...without(p.open, 'E'), 'E'] : without(p.open, 'E'), wall: without(p.wall, 'E') }, depth + 1, out, want);
    cut(r, { ...p, x0: x + way, open: way ? [...without(p.open, 'W'), 'W'] : without(p.open, 'W'), wall: without(p.wall, 'W') }, depth + 1, out, want);
  } else {
    const y = r.int(p.y0 + MIN, p.y1 - MIN - way);
    if (way) out.ways.push({ x0: p.x0, y0: y, x1: p.x1, y1: y + way });
    cut(r, { ...p, y1: y, open: way ? [...without(p.open, 'S'), 'S'] : without(p.open, 'S'), wall: without(p.wall, 'S') }, depth + 1, out, want);
    cut(r, { ...p, y0: y + way, open: way ? [...without(p.open, 'N'), 'N'] : without(p.open, 'N'), wall: without(p.wall, 'N') }, depth + 1, out, want);
  }
}

type Feature = 'pool' | 'maze' | 'playground' | 'greenhouse';
const FEATURE_MIN: Record<Feature, [number, number]> = { pool: [9, 8], maze: [9, 9], playground: [7, 6], greenhouse: [10, 10] };
const FEATURE_NAME: Record<Feature, string> = { pool: '泳池', maze: '树篱迷宫', playground: '儿童游乐场', greenhouse: '大温室' };
const fits = (f: Feature, p: Piece) => p.x1 - p.x0 >= FEATURE_MIN[f][0] && p.y1 - p.y0 >= FEATURE_MIN[f][1]
  && (f !== 'greenhouse' || p.open.some(s => s !== 'N'));

const ROOMS = ['statue', 'fountain', 'flowers', 'pergola', 'topiary'] as const;
type Room = typeof ROOMS[number];
const ROOM_NAME: Record<Room, string> = { statue: '雕像小花园', fountain: '小喷泉花园', flowers: '花圃', pergola: '花架凉亭', topiary: '动物造型树篱' };
type Use = Feature | Room | 'lawn' | 'strip' | 'shed' | 'smallGreenhouse';

// ------------------------------------------------------------------------------------------------
// the grounds

/** what the campus's groups hang on: the palace */
type Anch = { kind: 'building'; ref: string; x: number; y: number };

interface Ctx {
  L: Layout; sb: SceneBuilder; r: Rng;
  paving: string;
  /** cell is open ground (not lawn) */
  paved: Set<string>;
  anchor: Anch;
}

export function palaceGrounds(L: Layout, lm: Landmark, sb: SceneBuilder, r0: Rng) {
  const r = sb.enter(r0.fork('palace', { district: 'palace' }));
  const m = lm.buildings[0];
  const gf = lm.feats.find(f => f.kind === 'garden')!;
  const ox = gf.x0, oy = gf.y0, X1 = gf.x1, Y1 = gf.y1, mirror = gf.key === 'mirror';
  const px0 = m.cx, py0 = m.cy, px1 = px0 + PW, fy = py0 + PH, sy = fy + STAIR, ly = sy + LANE;
  const paving = r.choose('palace.paving', {}, ['sidewalk_beige', 'sidewalk_lightbeige', 'sidewalk_lightgrey', 'sidewalk_grey'].filter(s => s !== L.mainStyle));
  const anchor: Anch = { kind: 'building', ref: m.plan.id, x: (px0 + AXIS) * T, y: fy * T };
  const c: Ctx = { L, sb, r, paving, paved: new Set(), anchor };
  const pave = (b: Box) => { for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) c.paved.add(`${x},${y}`); };
  for (let y = oy; y < Y1; y++) for (let x = ox; x < X1; x++) L.base[y][x] = slab(paving, x, y);
  const gGarden = sb.group('palace-garden', gf.why, { anchor });

  // ---- the walk round the palace (behind it right across the garden; its sides run on to the street), the stair ----
  const walkN: Box = { x0: ox + 1, y0: py0 - WALK, x1: X1 - 1, y1: py0 };
  const walkW: Box = { x0: px0 - WALK, y0: py0, x1: px0, y1: Y1 }, walkE: Box = { x0: px1, y0: py0, x1: px1 + WALK, y1: Y1 };
  for (const [b, why] of [[walkN, '宫殿后面的步道：横穿花园，连起两边的步道和后面的小路'], [walkW, '宫殿西边的步道：从街上一直通到宫殿后面，下车处也能走进来'], [walkE, '宫殿东边的步道：从街上一直通到宫殿后面，下车处也能走进来']] as [Box, string][]) {
    pave(b);
    sb.clear(rect(b.x0 * T, b.y0 * T, b.x1 * T, b.y1 * T), 'gwalk', '宫殿花园的步道：保持畅通', gGarden);
    sb.zone('yard', 'palace-walk', rect(b.x0 * T, b.y0 * T, b.x1 * T, b.y1 * T), why, gGarden);
  }
  pave({ x0: px0 + SX0, y0: fy, x1: px0 + SX1, y1: sy });
  sb.clear(rect((px0 + SX0) * T, fy * T, (px0 + SX1) * T, sy * T), 'stairs', '宫殿的台阶：从下车处走上去进门', gGarden);

  // ---- the layout: the back, west and east parts cut into pieces (best of a few attempts at fitting the features) ----
  const nTop = oy + 2, nBot = py0 - WALK, sBot = Y1 - 2;
  const want: Feature[] = [];
  {
    // only features that fit one of the three parts at all (a narrow estate has no room for a pool)
    const parts: [number, number][] = [[px0 - WALK - ox - 1, sBot - py0], [X1 - 1 - px1 - WALK, sBot - py0], [X1 - ox - 2, nBot - nTop]];
    const pool = (['pool', 'maze', 'playground', 'greenhouse'] as Feature[]).filter(f => parts.some(([w, h]) => w >= FEATURE_MIN[f][0] && h >= FEATURE_MIN[f][1]));
    for (let i = 0, n = r.choose('palace.features', {}, { weights: [[1, 3], [2, 4], [3, 2]] as const }); i < n && pool.length; i++) {
      const f = r.choose('palace.feature', { i }, pool);
      want.push(f); pool.splice(pool.indexOf(f), 1);
    }
  }
  const court = nBot - nTop >= 6 && r.choose('palace.court', { mirror }, { p: mirror ? 0.6 : 0.3 });
  const c2 = ox + X1;   // mirror: x -> c2 - x
  const mirrorPiece = (p: Piece, twin: number): Piece => ({ x0: c2 - p.x1, x1: c2 - p.x0, y0: p.y0, y1: p.y1, open: p.open.map(s => flip[s]), wall: p.wall.map(s => flip[s]), twin });
  const plan = (rt: Rng): Cut & { court?: Box; axisWay?: Box } => {
    const out: Cut = { pieces: [], ways: [] };
    const side = (x0: number, x1: number, open: Side, wall: Side): Piece => ({ x0, y0: py0, x1, y1: sBot, open: ['N', open], wall: [wall, 'S'] });
    const west = side(ox + 1, px0 - WALK, 'E', 'W'), east = side(px1 + WALK, X1 - 1, 'W', 'E');
    let courtBox: Box | undefined, axisWay: Box | undefined;
    const back: Piece[] = [];
    const ax = px0 + AXIS;
    if (court || mirror) {
      // the middle of the back: a court (a centrepiece on the axis) or, mirrored without one, a 3-cell path up the axis
      const half = court ? rt.choose('palace.courtW', {}, [4.5, 5.5]) : 1.5;
      const b: Box = { x0: ax - half, y0: nTop, x1: ax + half, y1: nBot };
      if (court) courtBox = b; else axisWay = b;
      back.push({ x0: ox + 1, y0: nTop, x1: b.x0, y1: nBot, open: ['S', 'E'], wall: ['N', 'W'] });
      if (!mirror) back.push({ x0: b.x1, y0: nTop, x1: X1 - 1, y1: nBot, open: ['S', 'W'], wall: ['N', 'E'] });
    } else back.push({ x0: ox + 1, y0: nTop, x1: X1 - 1, y1: nBot, open: ['S'], wall: ['N', 'W', 'E'] });
    const parts = mirror ? [west, ...back] : [west, east, ...back];
    for (const p of parts) if (p.x1 - p.x0 >= 1 && p.y1 - p.y0 >= 1) cut(rt, p, 0, out, want);
    if (mirror) {
      const n = out.pieces.length;
      for (let i = 0; i < n; i++) { out.pieces[i].twin = n + i; out.pieces.push(mirrorPiece(out.pieces[i], i)); }
      for (const w of [...out.ways]) out.ways.push({ x0: c2 - w.x1, x1: c2 - w.x0, y0: w.y0, y1: w.y1 });
    }
    return { ...out, court: courtBox, axisWay };
  };
  const assign = (pieces: Piece[], rt: Rng) => {
    const got = new Map<number, Feature>();
    for (const f of want) {
      const fit = pieces.map((p, i) => i).filter(i => !got.has(i) && fits(f, pieces[i]));
      if (!fit.length) continue;
      // snug pieces first: a pool in a huge piece leaves it mostly empty
      const area = (i: number) => (pieces[i].x1 - pieces[i].x0) * (pieces[i].y1 - pieces[i].y0);
      got.set(rt.choose('palace.featurePiece', { f }, { weights: fit.map(i => [i, 1 / (10 + area(i) - FEATURE_MIN[f][0] * FEATURE_MIN[f][1])] as const) }), f);
    }
    return got;
  };
  let best: { cut: ReturnType<typeof plan>; got: Map<number, Feature> } | null = null;
  for (let t = 0; t < 12; t++) {
    const rt = r.fork(`try${t}`);
    const cutT = plan(rt), got = assign(cutT.pieces, rt);
    if (!best || got.size > best.got.size) best = { cut: cutT, got };
    if (got.size === want.length) break;
  }
  const { ways, court: courtBox, axisWay } = best!.cut;
  // pieces kept whole for a feature that went elsewhere are cut on (a 12 x 25 room with one statue is empty)
  const pieces: Piece[] = [], got = new Map<number, Feature>(), idx = new Map<number, number>();
  for (const [i, p] of best!.cut.pieces.entries()) {
    const f = best!.got.get(i);
    if (!f && (p.x1 - p.x0) * (p.y1 - p.y0) > 110) {
      const more: Cut = { pieces: [], ways: [] };
      cut(r, { ...p, twin: undefined }, 2, more, []);
      if (more.pieces.length > 1) { pieces.push(...more.pieces); ways.push(...more.ways); continue; }
    }
    idx.set(i, pieces.length);
    if (f) got.set(pieces.length, f);
    pieces.push({ ...p });
  }
  for (const p of pieces) p.twin = p.twin !== undefined ? idx.get(p.twin) : undefined;

  // ---- paths, the court / axis path ----
  for (const w of [...ways, ...(axisWay ? [axisWay] : [])]) {
    pave(w);
    sb.clear(rect(w.x0 * T, w.y0 * T, w.x1 * T, w.y1 * T), 'gwalk', '花园里的小路：从步道分出来，通到各块地', gGarden);
    sb.zone('yard', 'palace-walk', rect(w.x0 * T, w.y0 * T, w.x1 * T, w.y1 * T), w === axisWay ? '宫殿中轴上的小路：从后面的步道通到花园墙的铁门' : '花园里的小路：从步道分出来，把花园分成几块，每块都挨着一条路', gGarden);
  }
  if (courtBox) { pave(courtBox); court_(c, courtBox); }

  // ---- the garden wall: a tall hedge on the garden's outer edge; an iron gate where a path or the court meets it ----
  {
    const gid = sb.group('palace-wall', '花园墙：花园外沿的高树篱（Grass_Wall_2）；有小路通到北边的墙时，那里开一道铁门通到北边的街上（参考图 garden）', { anchor });
    const cells: [number, number][] = [];
    for (let x = ox; x < X1; x++) cells.push([x, oy]);
    for (let y = oy + 1; y <= sBot; y++) cells.push([ox, y], [X1 - 1, y]);
    for (let x = ox + 1; x < px0 - WALK; x++) cells.push([x, sBot]);
    for (let x = px1 + WALK; x < X1 - 1; x++) cells.push([x, sBot]);
    const toWall = [...(courtBox ? [courtBox] : []), ...(axisWay ? [axisWay] : []), ...ways.filter(w => w.y0 === nTop && w.y1 - w.y0 > w.x1 - w.x0)];
    const skip = new Set<string>();
    if (toWall.length && r.choose('palace.gate', {}, { p: 0.8 })) {
      const w = courtBox ?? axisWay ?? r.choose('palace.gateWay', {}, toWall);
      const gx = Math.round((w.x0 + w.x1) / 2 - 1.5);
      for (let i = 0; i < 3; i++) skip.add(`${gx + i},${oy}`);
      pave({ x0: gx, y0: oy, x1: gx + 3, y1: nTop });
      sb.putAt(r.choose('palace.gateModel', {}, [`${G}Gate_1`, `${G}Gate_2`]), gx * T, oy * T, 'fence', { gid, why: '花园墙上的铁门：花园的后门，对着通到墙边的路', force: true, occupy: false });
      sb.occupy(rect(gx * T, oy * T, (gx + 3) * T, (oy + 2) * T), 'fence');
    }
    hedge(sb, 'tall', cells, r.choose('palace.wallFlowers', {}, { p: 0.3 }), gid, '花园墙（高树篱）', skip);
    sb.zone('yard', 'palace-wall', rect(ox * T, oy * T, X1 * T, (oy + 2) * T), '花园墙（北边）', gid);
    // paths that end at the wall without a gate end at an ornament
    for (const w of ways) if (w.y0 === nTop && w.y1 - w.y0 >= 4 && w.y1 - w.y0 > w.x1 - w.x0 && !skip.has(`${Math.round((w.x0 + w.x1) / 2 - 1.5)},${oy}`) && r.choose('palace.wayEnd', {}, { p: 0.7 }))
      sb.putFoot(r.choose('palace.wayEndModel', {}, statues()), (w.x0 + w.x1) / 2 * T, (w.y0 + 2) * T + 4, 'statue', { gid: gGarden, why: '小路尽头靠墙的雕像 / 石柱：从步道看过去的对景', depth: 10, ignoreClear: true });
  }

  // ---- what each piece is: the features where they fit, the rest rooms, lawns, the shed ----
  const uses: Use[] = [];
  let shed = false, small = false;
  for (const [i, p] of pieces.entries()) {
    const f = got.get(i);
    if (f) { uses[i] = f; continue; }
    const w = p.x1 - p.x0, h = p.y1 - p.y0;
    const twin = p.twin !== undefined && p.twin < i ? uses[p.twin] : undefined;
    if (twin && (ROOMS as readonly string[]).includes(twin) || twin === 'lawn' || twin === 'strip') { uses[i] = twin!; continue; }
    if (Math.min(w, h) < MIN) { uses[i] = 'strip'; continue; }
    const opts: [Use, number][] = [...ROOMS.map(k => [k, 1] as [Use, number]), ['lawn', 2]];
    if (!shed && h >= 7) opts.push(['shed', 2]);
    if (!small && !want.includes('greenhouse') && w >= 7 && h >= 9 && p.open.some(s => s !== 'N')) opts.push(['smallGreenhouse', 2]);
    uses[i] = r.choose('palace.use', { w, h }, { weights: opts });
    if (uses[i] === 'shed') shed = true;
    if (uses[i] === 'smallGreenhouse') small = true;
  }
  for (const [i, p] of pieces.entries()) {
    const u = uses[i];
    switch (u) {
      case 'pool': pool(c, p); break;
      case 'maze': maze(c, p); break;
      case 'playground': playground(c, p); break;
      case 'greenhouse': case 'smallGreenhouse': case 'shed': service(c, p, u); break;
      case 'lawn': lawnTrees(c, p); break;
      case 'strip': strip(c, p); break;
      default: room(c, p, u, p.twin !== undefined && p.twin < i);
    }
  }
  for (const [b, name] of [[{ x0: ox, y0: oy, x1: X1, y1: py0 - WALK }, '后花园'], [{ x0: ox, y0: py0, x1: px0 - WALK, y1: Y1 }, '西侧花园'], [{ x0: px1 + WALK, y0: py0, x1: X1, y1: Y1 }, '东侧花园']] as [Box, string][])
    if (b.x1 > b.x0 && b.y1 > b.y0) sb.zone('yard', 'palace-garden', rect(b.x0 * T, b.y0 * T, b.x1 * T, b.y1 * T), `${name}（${b.x1 - b.x0}×${b.y1 - b.y0} 格）：${gf.why}`, gGarden);

  // ---- the beds either side of the stair, the drop-off, the front lawn / plaza ----
  beds(c, px0, fy, px0 + SX0, sy, anchor, false);
  beds(c, px0 + SX1, fy, px1, sy, anchor, true);
  dropoff(c, lm, px0, sy, px1, ly, Y1, anchor);
  const ff = lm.feats.find(f => f.kind === 'frontlawn' || f.kind === 'fountain')!;
  frontArea(c, ff, anchor);

  // ---- people: visitors on the walks and paths ----
  {
    const lanes = [walkN, { ...walkW, y1: fy }, { ...walkE, y1: fy }, ...ways].map(b => [b.x0 * T + 6, b.y0 * T + 16, b.x1 * T - 6, b.y1 * T - 2] as const);
    for (let i = 0, k = 0, n = r.int(4, 8); i < 4 * n && k < n; i++) {
      const [a, b, cc, d] = r.choose('palace.walker', {}, lanes);
      if (person(sb, r, r.int(a, Math.max(a, cc)), r.int(b, Math.max(b, d)), r.choose('palace.pose', {}, ['walk', 'walk', 'stand', 'phone'] as const),
        r.choose('palace.dir', {}, ['down', 'up', 'left', 'right'] as const), r.choose('palace.role', {}, ['citizen', 'citizen', 'business'] as const), gGarden, '在宫殿花园的步道上散步的游客')) k++;
    }
  }

  // ---- lawn on the campus's unpaved ground (the 9-slice by its neighbours), last: everything above marks what is paved ----
  const green = (x: number, y: number) => x >= ox && x < X1 && y >= oy && y < Y1 && !c.paved.has(`${x},${y}`) && !(x >= px0 && x < px1 && y >= py0 && y < fy);
  for (let y = oy; y < Y1; y++) for (let x = ox; x < X1; x++) if (green(x, y))
    L.over[y][x] = ['terr', !green(x - 1, y) ? 0 : !green(x + 1, y) ? 2 : 1, !green(x, y - 1) ? 11 : !green(x, y + 1) ? 13 : 12];
}

/** ornaments: statues on pedestals, pillars with an urn */
const statues = () => [...variants(`${G}Statue_Putto`), `${G}Pillar_1`, `${G}Pillar_2`, `${G}Pillar_3`, `${G}Pillar_4`].filter(hasSprite);

// ------------------------------------------------------------------------------------------------
// the pieces

/** the low hedge round a piece (not along the garden wall), its opening (2 cells) on an open side at a random place, or
 *  at `at`; an arch over it sometimes. Returns the opening's side and cells */
function enclose(c: Ctx, p: Piece, gid: string, o: { flowered?: boolean; arch?: boolean; at?: { side: Side; pos: number } } = {}) {
  const { sb, r } = c;
  const side = o.at && p.open.includes(o.at.side) ? o.at.side : r.choose('palace.openSide', {}, p.open);
  const len = side === 'N' || side === 'S' ? p.x1 - p.x0 : p.y1 - p.y0;
  const arch = o.arch && (side === 'N' || side === 'S') && len >= 5 && r.choose('palace.arch', {}, { p: 0.4 })
    ? r.choose('palace.archModel', {}, [`${G}Grass_Arch_1`, `${G}Grass_Arch_2`]) : null;
  const k = o.at && o.at.side === side ? Math.max(1, Math.min(len - 3, o.at.pos)) : r.int(1, Math.max(1, len - (arch ? 4 : 3)));
  const along = (i: number): [number, number] => side === 'N' ? [p.x0 + i, p.y0] : side === 'S' ? [p.x0 + i, p.y1 - 1] : side === 'W' ? [p.x0, p.y0 + i] : [p.x1 - 1, p.y0 + i];
  const gap = arch ? [along(k + 1)] : [along(k), along(k + 1)];
  const isGap = (x: number, y: number) => gap.some(([gx, gy]) => gx === x && gy === y);
  const onWall = (x: number, y: number) => (p.wall.includes('N') && y === p.y0) || (p.wall.includes('S') && y === p.y1 - 1) || (p.wall.includes('W') && x === p.x0) || (p.wall.includes('E') && x === p.x1 - 1);
  const cells: [number, number][] = [];
  for (let y = p.y0; y < p.y1; y++) for (let x = p.x0; x < p.x1; x++)
    if ((x === p.x0 || x === p.x1 - 1 || y === p.y0 || y === p.y1 - 1) && !isGap(x, y) && !onWall(x, y)) cells.push([x, y]);
  hedge(sb, 'low', cells, !!o.flowered, gid, '矮树篱');
  for (const [x, y] of gap) c.paved.add(`${x},${y}`);
  if (arch) {
    const [ax] = along(k);
    const s = spr(arch), bottom = (side === 'S' ? p.y1 : p.y0 + 1) * T;
    sb.putAt(arch, ax * T, bottom - s.bb[3], 'fence', { gid, why: '入口上的树篱拱门（参考图 garden）', force: true, occupy: false, foot: bottom });
  }
  return { side, gap };
}

const inner = (p: Piece) => ({ x0: (p.x0 + 1) * T, y0: (p.y0 + 1) * T, x1: (p.x1 - 1) * T, y1: (p.y1 - 1) * T });

/** n sprites from keys at random in the px box, each model at most once, the whole sprites kept apart (pad px) */
function scatter(c: Ctx, keys: string[], n: number, cls: string, gid: string, why: string, a: Box, pad = 6) {
  const { sb, r } = c;
  const out: NonNullable<ReturnType<SceneBuilder['putFoot']>>[] = [];
  const pool = keys.filter(hasSprite);
  for (let i = 0; i < 12 * n && out.length < n && pool.length; i++) {
    const key = r.choose('palace.scatter', { cls }, pool), sp = spr(key), hw = (sp.bb[2] - sp.bb[0]) / 2, hh = sp.bb[3] - sp.bb[1];
    if (a.x1 - a.x0 < 2 * hw + 2 || a.y1 - a.y0 < hh + 2) { pool.splice(pool.indexOf(key), 1); continue; }
    const o = sb.putFoot(key, r.int(Math.ceil(a.x0 + hw), Math.floor(a.x1 - hw)), r.int(Math.ceil(a.y0 + hh), a.y1), cls, { gid, why, depth: hh, pad, ignoreClear: true });
    if (o) { out.push(o); pool.splice(pool.indexOf(key), 1); }
  }
  return out;
}

function visitors(c: Ctx, a: Box, n: number, gid: string, why: string, o: { kid?: number; role?: string } = {}) {
  const { sb, r } = c;
  for (let i = 0, k = 0; i < 5 * n && k < n; i++)
    if (a.x1 - a.x0 > 16 && a.y1 - a.y0 > 16 && person(sb, r, r.int(a.x0 + 8, a.x1 - 8), r.int(a.y0 + 14, a.y1 - 2), r.choose('palace.vPose', {}, ['stand', 'walk', 'phone'] as const),
      r.choose('palace.vDir', {}, ['down', 'up', 'left', 'right'] as const), o.role ?? 'citizen', gid, why, o.kid !== undefined && r.choose('palace.kid', {}, { p: o.kid }))) k++;
}

/** a hedged room (statue / small fountain / flower beds / pergola / topiary) */
function room(c: Ctx, p: Piece, type: Room, mirrored: boolean) {
  const { sb, r } = c;
  const why = `${ROOM_NAME[type]}：矮树篱（Grass_Wall_1）围起来的小花园，开口朝着旁边的路${mirrored ? '（和对面那块对称）' : ''}`;
  const gid = sb.group('palace-room', why, { anchor: c.anchor });
  sb.zone('yard', 'palace-room', rect(p.x0 * T, p.y0 * T, p.x1 * T, p.y1 * T), `${why}（${p.x1 - p.x0}×${p.y1 - p.y0} 格）`, gid);
  enclose(c, p, gid, { flowered: r.choose('palace.roomFlowers', {}, { p: 0.35 }), arch: true });
  const I = inner(p), icx = (I.x0 + I.x1) / 2;
  const put = (key: string, fx: number, fy: number, cls: string, w: string, depth = 10) => hasSprite(key) ? sb.putFoot(key, fx, fy, cls, { gid, why: w, depth, ignoreClear: true }) : null;
  const centreY = (key: string) => Math.min(I.y1 - 4, (I.y0 + I.y1) / 2 + (spr(key).bb[3] - spr(key).bb[1]) / 2);
  switch (type) {
    case 'statue': {
      const k = r.choose('palace.roomStatue', {}, [...variants(`${G}Statue_Putto`), `${G}Light_Brown_Statue`, `${G}Grey_Statue`].filter(q => spr(q).h <= I.y1 - I.y0));
      const vase = r.choose('palace.vase', {}, [...variants(`${G}Blue_Vase_1`), ...variants(`${G}Blue_Vase_2`)].filter(q => /Flowers$/.test(q)));
      put(k, icx, centreY(k), 'statue', '小花园正中的雕像', 14);
      for (const [vx, vy] of [[I.x0 + 8, I.y0 + 18], [I.x1 - 8, I.y0 + 18], [I.x0 + 8, I.y1 - 2], [I.x1 - 8, I.y1 - 2]]) put(vase, vx, vy, 'plant', '雕像四角的花盆');
      break;
    }
    case 'fountain': {
      const f = put(r.choose('palace.roomFountain', {}, variants(`${G}Fountain_1`)), icx, (I.y0 + I.y1) / 2 + 20, 'utility', '小花园正中的小喷泉', 14);
      const bench = r.choose('palace.bench', {}, [`${G}Big_Bench_Horizontal`, `${G}Medium_Bench_Horizontal`]);
      if (f) for (const by of [I.y0 + 14, I.y1 - 2]) put(bench, icx, by, 'bench', '喷泉旁的长椅：坐着看喷泉');
      break;
    }
    case 'flowers': {
      const a = r.choose('palace.flower', {}, ['Red', 'Pink', 'White', 'Yellow', 'Light_Blue'].map(q => `${G}Big_${q}_Flower`).filter(hasSprite));
      const b = r.choose('palace.flower2', {}, [`${G}Big_Sunflower`, `${G}Medium_Sunflower`, `${G}Big_Pink_Flower`, `${G}Big_White_Flower`]);
      let k = 0;
      for (let y = I.y0 + 26; y <= I.y1 - 2; y += 2 * T) for (let x = I.x0 + 8; x < I.x1 - 4; x += T) put(k++ % 3 === 2 ? b : a, x, y, 'plant', '花圃里一行行的花');
      if (r.choose('palace.can', {}, { p: 0.6 })) put(r.choose('palace.canModel', {}, [`${G}Green_Watering_Can_Left_Full`, `${G}Red_Watering_Can_Full_Left`, `${G}Yellow_Watering_Can_Full_Left`, `${G}Grey_Watering_Can_Full_Left`].filter(hasSprite)), I.x1 - 10, I.y0 + 14, 'utility', '花圃里园丁的浇水壶');
      break;
    }
    case 'pergola': {
      const g = put(`${G}Pergola_Example`, icx, centreY(`${G}Pergola_Example`), 'utility', '小花园里的花架凉亭', 14);
      if (g) put(r.choose('palace.pergolaBench', {}, [`${G}Flowers_Bench_Horizontal`, `${G}Big_Bench_Horizontal`]), icx, I.y1 - 2, 'bench', '凉亭前的长椅');
      break;
    }
    case 'topiary':
      scatter(c, variants(`${G}Grass_Statue`), Math.max(1, Math.round((p.x1 - p.x0) * (p.y1 - p.y0) / 25)), 'plant', gid, '修剪成动物形状的树篱', I, 8);
      break;
  }
  // nothing fitted (a pergola in a narrow room): potted plants and flowers instead
  if (!sb.objects.some(o => o.gid === gid && o.cls !== 'fence'))
    scatter(c, [...variants(`${G}Bush_Potted`), `${G}Big_Red_Flower_Vase`, `${G}Big_White_Flower_Vase`, `${G}Big_Pink_Flower`, `${G}Big_Sunflower`], Math.max(2, Math.round((p.x1 - p.x0) * (p.y1 - p.y0) / 12)), 'plant', gid, '小花园里的盆栽和花', I, 4);
  if (r.choose('palace.roomVisitor', { type }, { p: 0.5 })) visitors(c, I, 1, gid, `在${ROOM_NAME[type]}里的游客`);
}

/** an informal lawn: trees, bushes and flowers at random, now and then a bench or a bird house; no hedge */
function lawnTrees(c: Ctx, p: Piece) {
  const { sb, r } = c;
  const gid = sb.group('palace-lawn', '草地：没有围起来的一块，随意种着树、灌木和花', { anchor: c.anchor });
  sb.zone('yard', 'palace-lawn', rect(p.x0 * T, p.y0 * T, p.x1 * T, p.y1 * T), `草地（${p.x1 - p.x0}×${p.y1 - p.y0} 格）`, gid);
  const a = { x0: p.x0 * T + 4, y0: p.y0 * T + 4, x1: p.x1 * T - 4, y1: p.y1 * T - 4 }, area = (p.x1 - p.x0) * (p.y1 - p.y0);
  const trees = ['3_City_Props/Tree_11', '3_City_Props/Tree_13', '3_City_Props/Tree_1', '3_City_Props/Tree_2', `${G}Bush_22`, `${G}Bush_23`, `${G}Bush_18`, `${G}Bush_20`].filter(hasSprite);
  for (let i = 0, n = Math.max(1, Math.round(area / 18)); i < n; i++) scatter(c, trees, 1, 'tree', gid, '草地上的树 / 灌木', a, 10);
  scatter(c, ['Red', 'Pink', 'White', 'Yellow'].map(q => `${G}Big_${q}_Flower`), r.int(0, 3), 'plant', gid, '草地上的一丛花', a, 4);
  if (r.choose('palace.lawnBench', {}, { p: 0.4 })) scatter(c, [`${G}Big_Bench_Horizontal`, `${G}Square_Bench`], 1, 'bench', gid, '草地上的长椅', a, 8);
  if (r.choose('palace.birdHouse', {}, { p: 0.3 })) scatter(c, ['Blue', 'Brown', 'Pink', 'Red'].map(q => `${G}${q}_Big_Bird_House`), 1, 'utility', gid, '草地上的鸟屋', a, 8);
  if (r.choose('palace.lawnVisitor', {}, { p: 0.4 })) visitors(c, a, 1, gid, '在草地上的人');
}

/** a piece too thin for anything else: a row of bushes or flowers along it */
function strip(c: Ctx, p: Piece) {
  const { sb, r } = c;
  const w = p.x1 - p.x0, h = p.y1 - p.y0;
  if (Math.max(w, h) < 3) return;
  const gid = sb.group('palace-strip', '窄条绿地：一行灌木或花', { anchor: c.anchor });
  const key = r.choose('palace.stripPlant', {}, [`${G}Bush_1`, `${G}Bush_2`, `${G}Bush_3`, `${G}Bush_5`, `${G}Big_Red_Flower`, `${G}Big_White_Flower`].filter(hasSprite));
  const step = r.choose('palace.stripStep', {}, [1, 2]);
  if (w >= h) { const y = (p.y0 + Math.floor(h / 2) + 1) * T - 2; for (let x = p.x0 + 0.5; x < p.x1; x += step) sb.putFoot(key, x * T, y, 'plant', { gid, why: '窄条绿地上的一行灌木 / 花', ignoreClear: true }); }
  else { const x = (p.x0 + w / 2) * T; for (let y = p.y0 + 1; y <= p.y1; y += step) sb.putFoot(key, x, y * T - 2, 'plant', { gid, why: '窄条绿地上的一行灌木 / 花', ignoreClear: true }); }
}

/** the court on the axis behind the palace: the centrepiece, benches either side, urns */
function court_(c: Ctx, b: Box) {
  const { sb, r } = c;
  const h = b.y1 - b.y0;
  const pool = [`${G}Fountain_3_1`, `${G}Fountain_3_2`, `${G}Fountain_3_3`, `${G}Fountain_3_4`, `${G}Fountain_2_1`, `${G}Fountain_2_2`, `${G}Light_Brown_Statue`, `${G}Grey_Statue`, ...(h >= 8 ? [`${G}Statue_Angel_1`, `${G}Statue_Angel_2`] : [])]
    .filter(k => hasSprite(k) && spr(k).h / T <= h - 1 && spr(k).w / T <= b.x1 - b.x0 - 4);
  const key = r.choose('palace.centre', { h }, pool);
  const why = `宫殿后面的庭院：在中轴上，正中是${key.includes('Fountain') ? '喷泉' : '雕像'}，从宫殿后面的步道走过来`;
  const gid = sb.group('palace-court', why, { anchor: c.anchor });
  sb.zone('yard', 'plaza', rect(b.x0 * T, b.y0 * T, b.x1 * T, b.y1 * T), `${why}（${b.x1 - b.x0}×${h} 格）`, gid);
  const cx = (b.x0 + b.x1) / 2 * T, s = spr(key);
  const fy = Math.round(b.y0 * T + (h * T + (s.bb[3] - s.bb[1])) / 2) - 2;
  const o = sb.putFoot(key, cx, fy, 'utility', { gid, why: '庭院正中的' + (key.includes('Fountain') ? '喷泉' : '雕像') + '：正对宫殿的中轴', depth: Math.min(40, s.bb[3] - s.bb[1]), ignoreClear: true });
  const bench = r.choose('palace.courtBench', {}, [`${G}Big_Bench_Vertical`, `${G}Medium_Bench_Vertical`]);
  if (o) for (const bx of [b.x0 * T + 10, b.x1 * T - 10]) sb.putFoot(bench, bx, fy, 'bench', { gid, why: '庭院两边的长椅：坐着看喷泉 / 雕像', ignoreClear: true });
  const urn = r.choose('palace.urn', {}, [`${G}Big_Red_Flower_Vase`, `${G}Big_White_Flower_Vase`, `${G}Big_Pink_Flower_Vase`, `${G}Big_Light_Blue_Flower_Vase`].filter(hasSprite));
  for (const [ux, uy] of [[b.x0 * T + 8, (b.y1 - 0.5) * T], [b.x1 * T - 8, (b.y1 - 0.5) * T], [b.x0 * T + 8, (b.y0 + 1) * T + 4], [b.x1 * T - 8, (b.y0 + 1) * T + 4]])
    sb.putFoot(urn, ux, uy, 'plant', { gid, why: '庭院四角的花瓶', ignoreClear: true });
}

/** the pool (14_Swimming_Pool, ref different_swimming_pools): a paved deck inside the hedge, the pool (rim 1/2/3 top,
 *  8/4 sides, 7/6/5 bottom; tiled water 20/21/22 first row, 19/23/24 below; ladder 39), floats in the water, sunbeds and
 *  umbrellas on the deck, palms in the corners */
function pool(c: Ctx, p: Piece) {
  const { L, sb, r } = c;
  const gid = sb.group('palace-pool', '泳池：矮树篱围着，铺地上是泳池、躺椅、遮阳伞和棕榈树（参考图 different_swimming_pools）', { anchor: c.anchor });
  sb.zone('yard', 'palace-pool', rect(p.x0 * T, p.y0 * T, p.x1 * T, p.y1 * T), `泳池（${p.x1 - p.x0}×${p.y1 - p.y0} 格）`, gid);
  enclose(c, p, gid);
  const ix0 = p.x0 + 1, iy0 = p.y0 + 1, ix1 = p.x1 - 1, iy1 = p.y1 - 1, iw = ix1 - ix0, ih = iy1 - iy0;
  const deck = r.choose('palace.deck', {}, ['sidewalk_lightgrey', 'sidewalk_lightbeige', 'sidewalk_blue']);
  for (let y = iy0; y < iy1; y++) for (let x = ix0; x < ix1; x++) { L.base[y][x] = slab(deck, x, y); c.paved.add(`${x},${y}`); }
  // water 3-12 x 2-5, a row of deck above, two below for the sunbeds where there is room
  const wMax = Math.max(3, Math.min(iw - 4, 12)), hMax = Math.max(2, Math.min(ih - 5, 5));
  const ww = r.int(Math.max(3, Math.ceil(wMax * 0.6)), wMax), wh = r.int(Math.max(2, Math.ceil(hMax * 0.6)), hMax);
  const pw = ww + 2, ph = wh + 2;
  const px = ix0 + Math.floor((iw - pw) / 2) + r.int(-1, 1) * (iw - pw >= 4 ? 1 : 0), py = iy0 + 1;
  const flat = (key: string, x: number, y: number, why: string, foot: number) => sb.putAt(key, x, y, 'pool', { gid, why, force: true, occupy: false, foot });
  for (let y = py; y < py + ph; y++) for (let x = px; x < px + pw; x++) {
    const top = y === py, bot = y === py + ph - 1, left = x === px, right = x === px + pw - 1;
    const n = top ? (left ? 1 : right ? 3 : 2) : bot ? (left ? 7 : right ? 5 : 6) : left ? 8 : right ? 4
      : y === py + 1 ? (x === px + 1 ? 20 : x === px + pw - 2 ? 22 : 21) : (x === px + 1 ? 19 : x === px + pw - 2 ? 24 : 23);
    flat(`${P}Pool_${n}`, x * T, y * T, '泳池', py * T);
  }
  sb.occupy(rect(px * T, py * T, (px + pw) * T, (py + ph) * T), 'pool');
  flat(`${P}Pool_39`, r.int(px + 1, px + pw - 2) * T, py * T, '泳池的扶梯', py * T + 1);
  for (let i = 0, n = ww >= 5 && wh >= 2 ? r.int(1, 2) : ww >= 3 && wh >= 2 ? r.int(0, 1) : 0; i < n; i++) {
    const k = r.choose('palace.float', {}, variants(`${P}Toy_Floating`).filter(q => spr(q).w <= 32 && spr(q).h <= 32));
    flat(k, r.int(px + 1, px + pw - 3) * T, r.int(py + 1, py + ph - 3) * T, '泳池里漂着的游泳圈 / 充气玩具', py * T + 2);
  }
  // the deck below: sunbeds in a row with an umbrella or a small table between; palms in the free corners
  const bedY = (py + ph + 2) * T - 1;
  if (bedY <= iy1 * T) {
    const bed = r.choose('palace.sunbed', {}, variants(`${P}Sunbed`, [1, 2, 3, 4, 5, 6]));
    for (let x = ix0 * T + 16; x <= ix1 * T - 16; x += r.choose('palace.bedStep', {}, [40, 48])) {
      sb.putFoot(bed, x, bedY, 'bench', { gid, why: '泳池边的躺椅', depth: 12, ignoreClear: true, pad: 1 });
      if (r.choose('palace.umbrella', {}, { p: 0.3 })) sb.putFoot(r.choose('palace.umbrellaModel', {}, variants(`${P}Umbrella`, [1, 2, 3, 4])), x + 22, bedY, 'utility', { gid, why: '躺椅旁的遮阳伞', depth: 6, ignoreClear: true });
      else if (r.choose('palace.tinyTable', {}, { p: 0.3 })) sb.putFoot(r.choose('palace.tinyTableModel', {}, variants(`${P}Wooden_Tiny_Table`)), x + 20, bedY - 4, 'table', { gid, why: '躺椅旁的小桌', ignoreClear: true });
    }
  }
  scatter(c, variants(`${P}Palm`), r.int(0, 2), 'tree', gid, '泳池边的棕榈树', { x0: ix0 * T, y0: (py + ph) * T, x1: ix1 * T, y1: iy1 * T }, 4);
  if (r.choose('palace.lifesaver', {}, { p: 0.5 })) scatter(c, variants(`${P}Lifesaver_Holder`), 1, 'utility', gid, '泳池边的救生圈架', { x0: ix0 * T, y0: iy0 * T, x1: ix1 * T, y1: (py + 1) * T }, 2);
  visitors(c, { x0: ix0 * T, y0: (py + ph) * T, x1: ix1 * T, y1: iy1 * T }, r.int(1, 3), gid, '泳池边的人', { kid: 0.3 });
}

/** a hedge maze: a random spanning tree over the odd cells (walls of low hedge, junctions included), the way in from an
 *  open side, sometimes a way out on another, a clearing with a fountain or statue in the middle of the bigger ones */
function maze(c: Ctx, p: Piece) {
  const { L, sb, r } = c;
  const gid = sb.group('palace-maze', '树篱迷宫：矮树篱围出的小路，入口朝着旁边的路，大的迷宫中间有一块空地和雕像 / 喷泉', { anchor: c.anchor });
  sb.zone('yard', 'palace-maze', rect(p.x0 * T, p.y0 * T, p.x1 * T, p.y1 * T), `树篱迷宫（${p.x1 - p.x0}×${p.y1 - p.y0} 格）`, gid);
  const odd = (n: number) => n % 2 ? n : n - 1;
  const mw = Math.min(odd(p.x1 - p.x0), 21), mh = Math.min(odd(p.y1 - p.y0), 17);
  const mx = p.x0 + Math.floor((p.x1 - p.x0 - mw) / 2), my = p.y0 + Math.floor((p.y1 - p.y0 - mh) / 2);
  const wall = Array.from({ length: mh }, () => Array<boolean>(mw).fill(true));
  const seen = new Set<string>();
  const stack: [number, number][] = [[1 + 2 * r.int(0, (mw - 3) / 2), 1 + 2 * r.int(0, (mh - 3) / 2)]];
  wall[stack[0][1]][stack[0][0]] = false; seen.add(`${stack[0][0]},${stack[0][1]}`);
  while (stack.length) {
    const [x, y] = stack[stack.length - 1];
    const next = ([[2, 0], [-2, 0], [0, 2], [0, -2]] as const).map(([dx, dy]) => [x + dx, y + dy] as [number, number]).filter(([nx, ny]) => nx > 0 && ny > 0 && nx < mw - 1 && ny < mh - 1 && !seen.has(`${nx},${ny}`));
    if (!next.length) { stack.pop(); continue; }
    const [nx, ny] = next[r.int(0, next.length - 1)];
    wall[(y + ny) / 2][(x + nx) / 2] = false; wall[ny][nx] = false; seen.add(`${nx},${ny}`); stack.push([nx, ny]);
  }
  // the clearing in the middle
  const cx = 1 + 2 * Math.floor((mw - 1) / 4), cy = 1 + 2 * Math.floor((mh - 1) / 4);
  const clearing = mw >= 11 && mh >= 11;
  if (clearing) for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) wall[y][x] = false;
  // the ways in / out: a border cell next to an open odd cell, on an open side of the piece
  const door = (side: Side) => {
    const len = side === 'N' || side === 'S' ? mw : mh;
    const i = 1 + 2 * r.int(0, (len - 3) / 2);
    const [x, y] = side === 'N' ? [i, 0] : side === 'S' ? [i, mh - 1] : side === 'W' ? [0, i] : [mw - 1, i];
    wall[y][x] = false;
    // the margin between a maze narrower than its piece and the path is lawn: walkable
  };
  const inSide = r.choose('palace.mazeIn', {}, p.open);
  door(inSide);
  const others = p.open.filter(s => s !== inSide);
  if (others.length && r.choose('palace.mazeOut', {}, { p: 0.6 })) door(r.choose('palace.mazeOutSide', {}, others));
  const cells: [number, number][] = [];
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
    if (wall[y][x]) cells.push([mx + x, my + y]);
    else { L.base[my + y][mx + x] = slab(c.paving, mx + x, my + y); c.paved.add(`${mx + x},${my + y}`); }
  }
  hedge(sb, 'low', cells, r.choose('palace.mazeFlowers', {}, { p: 0.25 }), gid, '迷宫的树篱');
  if (clearing) {
    const k = r.choose('palace.mazeCentre', {}, [...variants(`${G}Fountain_1`), ...variants(`${G}Statue_Putto`)]);
    sb.putFoot(k, (mx + cx + 0.5) * T, (my + cy + 1.5) * T - 2, 'statue', { gid, why: '迷宫中间空地上的喷泉 / 雕像：走到这里就到了', depth: 12, ignoreClear: true });
  }
  // people in the passages
  for (let i = 0, k = 0, n = r.int(1, 3); i < 20 && k < n; i++) {
    const x = r.int(1, mw - 2), y = r.int(1, mh - 2);
    if (!wall[y][x] && person(sb, r, (mx + x + 0.5) * T, (my + y + 1) * T - 2, r.choose('palace.mazePose', {}, ['walk', 'stand'] as const), r.choose('palace.mazeDir', {}, ['down', 'up', 'left', 'right'] as const), 'citizen', gid, '在迷宫里找路的人', r.choose('palace.mazeKid', {}, { p: 0.5 }))) k++;
  }
}

/** a playground: hedged lawn with the school yard toys (ref playground_for_kids), a bench for the parents, children */
function playground(c: Ctx, p: Piece) {
  const { sb, r } = c;
  const gid = sb.group('palace-playground', '儿童游乐场：矮树篱围着的草地，滑梯、秋千、攀爬架，旁边一张给家长坐的长椅（参考图 playground_for_kids）', { anchor: c.anchor });
  sb.zone('yard', 'playground', rect(p.x0 * T, p.y0 * T, p.x1 * T, p.y1 * T), `儿童游乐场（${p.x1 - p.x0}×${p.y1 - p.y0} 格）`, gid);
  const { side, gap } = enclose(c, p, gid);
  const I = inner(p);
  // the bench just inside the opening
  const [gx, gy] = gap[0];
  const bx = side === 'W' ? (gx + 1.5) * T : side === 'E' ? (gx - 1) * T : (gx + 2.5) * T, by = side === 'N' ? (gy + 2) * T : side === 'S' ? (gy - 0.2) * T : (gy + 2.5) * T;
  sb.putFoot(r.choose('palace.pgBench', {}, [`${G}Big_Bench_Horizontal`, `${G}Medium_Bench_Horizontal`, `${G}Square_Bench`]), bx, by, 'bench', { gid, why: '游乐场入口旁给家长坐的长椅', ignoreClear: true });
  const toys = [2, 3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 15, 16, 18, 19].map(i => `13_School/School_Yard_Toy_${i}`);
  scatter(c, toys, Math.max(2, Math.min(6, Math.round((p.x1 - p.x0) * (p.y1 - p.y0) / 16))), 'playground', gid, '游乐场里的游乐设施（滑梯、秋千、攀爬架等）', I, 6);
  visitors(c, I, r.int(2, 4), gid, '在游乐场玩的孩子', { kid: 0.9 });
  visitors(c, I, 1, gid, '看着孩子的家长');
}

/** the gardener's corner: the big greenhouse (Large_Greenhouse_Example widened by repeating its modular columns 1 and 6),
 *  the small one, or the shed; a paved yard at its door through to the opening, seedling rows, tools, the gardener */
function service(c: Ctx, p: Piece, kind: 'greenhouse' | 'smallGreenhouse' | 'shed') {
  const { L, sb, r } = c;
  const name = kind === 'greenhouse' ? '大温室' : kind === 'smallGreenhouse' ? '温室' : '园丁小屋';
  const why = kind === 'shed' ? '园丁小屋：放工具、推车和木箱，门前一块铺地通到路上（参考图 garden）' : `${name}：园丁育苗、养盆花的地方，门前一块铺地通到路上，旁边是一行行的幼苗（参考图 garden_warmhouse）`;
  const gid = sb.group(kind === 'shed' ? 'palace-shed' : 'palace-greenhouse', why, { anchor: c.anchor });
  sb.zone('yard', 'palace-service', rect(p.x0 * T, p.y0 * T, p.x1 * T, p.y1 * T), `${why}（${p.x1 - p.x0}×${p.y1 - p.y0} 格）`, gid);
  const ix0 = p.x0 + 1, iy0 = p.y0 + 1, ix1 = p.x1 - 1, iy1 = p.y1 - 1, iw = ix1 - ix0;
  // the building: its sprite pieces (one, or the greenhouse's columns), width in cells
  let segs: { key: string; clip?: [number, number, number, number] }[], w: number, h: number;
  if (kind === 'greenhouse') {
    const key = `${G}Large_Greenhouse_Example`, gh = spr(key).h;
    const k = r.int(Math.min(1, Math.floor((iw - 8) / 2)), Math.max(0, Math.min(4, Math.floor((iw - 8) / 2))));
    const col = (a: number, b: number) => ({ key, clip: [a, 0, b, gh] as [number, number, number, number] });
    segs = [col(0, 16), ...Array(k + 1).fill(col(16, 32)), col(32, 96), ...Array(k + 1).fill(col(96, 112)), col(112, 128)];
    w = 8 + 2 * k; h = gh / T;
  } else {
    const key = kind === 'smallGreenhouse' ? `${G}Small_Greenhouse_Example` : r.choose('palace.shed', {}, ['Brown', 'Red_Brown', 'Blue_Brown', 'White', 'Red_White', 'Blue_White'].map(s => `${G}${s}_Wood_Storage`));
    segs = [{ key }]; w = spr(key).w / T; h = spr(key).h / T;
  }
  // against the back of the piece (away from a southern opening), door row below it, paved 2 rows
  const bx = ix0 + (iw - w > 1 ? r.int(0, iw - w) : Math.max(0, Math.floor((iw - w) / 2))), by = iy0, doorRow = by + h;
  const doorX = bx + Math.floor(w / 2);
  const yard: Box = { x0: ix0, y0: doorRow, x1: ix1, y1: Math.min(iy1, doorRow + 2) };
  const at = p.open.includes('S') && r.choose('palace.serviceSouth', {}, { p: 0.7 }) ? { side: 'S' as Side, pos: doorX - p.x0 - 1 }
    : p.open.includes('E') ? { side: 'E' as Side, pos: doorRow - p.y0 } : p.open.includes('W') ? { side: 'W' as Side, pos: doorRow - p.y0 } : { side: 'S' as Side, pos: doorX - p.x0 - 1 };
  const { side } = enclose(c, p, gid, { at });
  for (let y = yard.y0; y < yard.y1; y++) for (let x = yard.x0; x < yard.x1; x++) { L.base[y][x] = slab(c.paving, x, y); c.paved.add(`${x},${y}`); }
  if (side === 'S') for (let y = yard.y1; y < iy1; y++) for (let x = doorX - 1; x <= doorX; x++) c.paved.add(`${x},${y}`);
  sb.clear(rect(yard.x0 * T, yard.y0 * T, yard.x1 * T, yard.y1 * T), 'gwalk', `${name}门前的铺地：保持畅通`, gid);
  let x = bx * T;
  for (const s of segs) {
    const o = sb.putAt(s.key, x, by * T, 'building', { gid, why: kind === 'shed' ? '园丁放工具的木头小屋' : `${name}：玻璃房，里面是一排排的花盆和幼苗`, force: true, occupy: false, clip: s.clip, foot: doorRow * T - 1 });
    x += o!.w;
  }
  sb.occupy(rect(bx * T, (by + Math.max(1, h - 3)) * T, (bx + w) * T, doorRow * T), 'building');
  // beside / below: seedling rows (greenhouses) or the cart and boxes (shed); tools by the door; the gardener
  const below: Box = { x0: ix0 * T, y0: yard.y1 * T, x1: ix1 * T, y1: iy1 * T };
  const beside: Box = bx - ix0 >= ix1 - bx - w ? { x0: ix0 * T, y0: iy0 * T, x1: bx * T, y1: doorRow * T } : { x0: (bx + w) * T, y0: iy0 * T, x1: ix1 * T, y1: doorRow * T };
  if (kind === 'shed') scatter(c, [...variants(`${G}Small_Wood_Cart_Full`), ...variants(`${G}Big_Wood_Cart_Full`), ...variants(`${G}Wood_Box_Full`), `${G}Sprout_Tools_Shelf`], 3, 'utility', gid, '园丁的推车、木箱和工具架', beside.x1 - beside.x0 >= 2 * T ? beside : below, 2);
  else {
    const sprout = r.choose('palace.sprout', {}, [...variants(`${G}Big_Sprout`), ...variants(`${G}Medium_Sprout`)]);
    for (let y = below.y0 + 14; y <= below.y1 - 2; y += 2 * T) for (let xx = below.x0 + 8; xx <= below.x1 - 8; xx += T)
      if (!(side === 'S' && xx > (doorX - 1) * T - 8 && xx < (doorX + 1) * T + 8)) sb.putFoot(sprout, xx, y, 'plant', { gid, why: `${name}前的苗圃：一行行的幼苗`, ignoreClear: true });
    scatter(c, [`${G}Sprout_Tools_Shelf`, ...variants(`${G}Wood_Box_Full`), `${G}Flowers_Shelf_1`], r.int(1, 2), 'utility', gid, `${name}旁的工具架、木箱`, beside, 2);
  }
  const tool = r.choose('palace.tool', {}, ['Blue_Rake', 'Brown_Shovel', 'Green_Rake', 'Red_Rake', 'Red_Shovel', 'Yellow_Rake'].map(t => `${G}Ground_${t}_Right`).filter(hasSprite));
  sb.putFoot(tool, (bx + w + 0.5) * T, (doorRow - 0.3) * T, 'utility', { gid, why: '园丁放在门边地上的耙子 / 铲子', ignoreClear: true });
  if (r.choose('palace.gardener', { kind }, { p: 0.8 }))
    person(sb, r, (doorX + 1.5) * T, (doorRow + 1) * T, r.choose('palace.gardenerPose', {}, ['stand', 'walk'] as const), r.choose('palace.gardenerDir', {}, ['down', 'left', 'right'] as const), 'citizen', gid, `${name}门前的园丁`);
}

/** a bed beside the stair: low hedge round a strip of lawn, flowers and potted topiary in it */
function beds(c: Ctx, x0: number, y0: number, x1: number, y1: number, anchor: Anch, mirror: boolean) {
  const { sb, r } = c;
  const why = `宫殿台阶${mirror ? '东' : '西'}侧的花坛：贴着宫殿正面，矮树篱围起来，里面是花和修剪过的盆栽`;
  const gid = sb.group('palace-beds', why, { anchor });
  sb.zone('yard', 'palace-beds', rect(x0 * T, y0 * T, x1 * T, y1 * T), why, gid);
  hedge(sb, 'low', ring(x0, y0 + 1, x1, y1), false, gid, '花坛的矮树篱');
  const pot = r.choose('palace.bedPot', { mirror }, variants(`${G}Bush_Potted`, [6, 7, 8]));
  const flower = r.choose('palace.bedFlower', { mirror }, ['Red', 'Pink', 'White', 'Yellow'].map(k => `${G}Medium_${k}_Flower`).filter(hasSprite));
  const ix0 = (x0 + 1) * T, ix1 = (x1 - 1) * T;
  sb.putFoot(pot, ix0 + 8, (y1 - 1) * T - 1, 'plant', { gid, why: '花坛两头的盆栽', ignoreClear: true });
  sb.putFoot(pot, ix1 - 8, (y1 - 1) * T - 1, 'plant', { gid, why: '花坛两头的盆栽', ignoreClear: true });
  for (let fx = ix0 + 24; fx < ix1 - 16; fx += T) for (const fy of [(y0 + 2) * T + 12, (y0 + 3) * T + 12]) sb.putFoot(flower, fx, fy, 'plant', { gid, why: '花坛里的花', ignoreClear: true });
}

/** the drop-off: the lane at the stair's foot, two legs down to the street (one in, one out), a car letting guests off */
function dropoff(c: Ctx, lm: Landmark, x0: number, y0: number, x1: number, ly: number, Y1: number, anchor: Anch) {
  const { L, sb, r } = c;
  const f = lm.feats.find(q => q.kind === 'dropoff')!;
  const gid = sb.group('palace-dropoff', f.why, { anchor });
  const legW = [x0 + 1, x0 + 4], legE = [x1 - 4, x1 - 1];
  const asph = (a: number, b: number, cc: number, d: number) => { for (let y = b; y < d; y++) for (let x = a; x < cc; x++) { L.base[y][x] = asphalt(r); c.paved.add(`${x},${y}`); } };
  asph(x0, y0, x1, ly); asph(legW[0], ly, legW[1], Y1); asph(legE[0], ly, legE[1], Y1);
  sb.zone('yard', 'parking', rect(x0 * T, y0 * T, x1 * T, ly * T), `${f.why}（${x1 - x0}×${ly - y0} 格）`, gid);
  for (const [a, b] of [legW, legE]) sb.zone('yard', 'parking', rect(a * T, ly * T, b * T, Y1 * T), '下车处的车道：从街上开进来 / 开出去', gid);
  sb.clear(rect(x0 * T, y0 * T, x1 * T, ly * T), 'aisle', '下车处的车道：车开进来停在台阶前，再开出去，保持畅通', gid);
  // low hedges between the legs and the walks
  hedge(sb, 'low', Array.from({ length: Y1 - ly }, (_, i) => [x0, ly + i] as [number, number]), false, gid, '车道和步道之间的矮树篱');
  hedge(sb, 'low', Array.from({ length: Y1 - ly }, (_, i) => [x1 - 1, ly + i] as [number, number]), false, gid, '车道和步道之间的矮树篱');
  const inWest = r.choose('palace.inWest', {}, { p: 0.5 });
  driveway(L, sb, r, legW[0], 3, Y1, gid, inWest ? '下车处的入口车道：车从马路开进来，路缘在这里断开' : '下车处的出口车道：车从这里开上马路，路缘在这里断开');
  driveway(L, sb, r, legE[0], 3, Y1, gid, inWest ? '下车处的出口车道：车从这里开上马路，路缘在这里断开' : '下车处的入口车道：车从马路开进来，路缘在这里断开');
  // the car at the stair's foot, heading for the exit; its driver; the guest going up; the guards
  const ax = (x0 + AXIS) * T;
  const carKeys = variants(`10_Vehicles/Car_${inWest ? 'Right' : 'Left'}`).filter(k => spr(k).w <= 80);
  const car = sb.putFoot(r.choose('palace.car', {}, carKeys), ax, (y0 + 3) * T - 2, 'vehicle', { gid, why: '停在台阶前让客人下车的车', depth: 30, ignoreClear: true });
  if (car) {
    person(sb, r, car.x + (inWest ? -10 : car.w + 10), (y0 + 3) * T - 4, 'stand', inWest ? 'right' : 'left', 'business', gid, '下车处：站在车旁的司机');
    if (r.choose('palace.waiting', {}, { p: 0.4 }))
      sb.putFoot(r.choose('palace.car2', {}, variants('10_Vehicles/Car_Up').filter(k => spr(k).w <= 48 && spr(k).h <= 80)), ((inWest ? legW[0] : legE[0]) + 1.5) * T, Y1 * T - 4, 'vehicle', { gid, why: '在入口车道上排队等着下客的车', depth: 30, ignoreClear: true });
  }
  for (let i = 0, k = 0, n = r.int(1, 2); i < 6 && k < n; i++)
    if (person(sb, r, ax + r.int(-30, 30), (y0 - r.int(1, 4)) * T + r.int(0, 12), r.choose('palace.guestPose', {}, ['walk', 'stand'] as const), 'up', 'business', gid, '走上台阶的客人')) k++;
  for (const gx of [(x0 + SX0 - 0.5) * T, (x0 + SX1 + 0.5) * T]) person(sb, r, gx, y0 * T + 12, 'stand', 'down', 'police', gid, '台阶脚下站岗的卫兵');
}

/** outside the drive: the lawn (two hedged parterres with statues, the axis path between) or the fountain plaza */
function frontArea(c: Ctx, f: Feat, anchor: Anch) {
  const { sb, r } = c;
  const gid = sb.group(f.kind === 'fountain' ? 'palace-plaza' : 'palace-lawn', f.why, { anchor });
  const ax = (f.x0 + f.x1) / 2;   // the axis (cells)
  const pa = Math.round(ax - 1.5), pb = pa + 3;
  if (f.kind === 'fountain') {
    for (let y = f.y0; y < f.y1; y++) for (let x = f.x0; x < f.x1; x++) c.paved.add(`${x},${y}`);
    sb.zone('block', 'plaza', rect(f.x0 * T, f.y0 * T, f.x1 * T, f.y1 * T), `${f.why}（${f.x1 - f.x0}×${f.y1 - f.y0} 格）`, gid);
    const key = r.choose('palace.plazaFountain', {}, [...variants(`${G}Fountain_3`), ...variants('3_City_Props/Fountain')].filter(k => spr(k).h / T <= f.y1 - f.y0 - 1));
    const s = spr(key), fy = Math.round((f.y0 + f.y1) / 2 * T + (s.bb[3] - s.bb[1]) / 2);
    const o = sb.putFoot(key, ax * T, fy, 'utility', { gid, why: '广场正中的喷泉：在宫殿的中轴上', depth: Math.min(40, s.bb[3] - s.bb[1]), ignoreClear: true });
    if (o) for (const bx of [f.x0 * T + 26, f.x1 * T - 26]) sb.putFoot(`${G}Big_Bench_Vertical`, bx, fy, 'bench', { gid, why: '喷泉两边的长椅', ignoreClear: true });
    const bed = r.choose('palace.plazaBed', {}, variants('3_City_Props/Flower_Bush', [1, 2, 3]));
    // the street corners 2 cells in: the driveways' keep-clear reaches 6 px into the plaza
    for (const [bx, by] of [[f.x0 + 1, f.y0 + 1.5], [f.x1 - 1, f.y0 + 1.5], [f.x0 + 2, f.y1 - 0.3], [f.x1 - 2, f.y1 - 0.3]]) sb.putFoot(bed, bx * T, by * T, 'plant', { gid, why: '广场四角的花坛', ignoreClear: ['aisle', 'gwalk'] });
    for (let i = 0, k = 0, n = r.int(2, 4); i < 5 * n && k < n; i++)
      if (person(sb, r, r.int(f.x0 * T + 8, f.x1 * T - 8), r.int(f.y0 * T + 16, f.y1 * T - 2), r.choose('palace.plazaPose', {}, ['walk', 'stand', 'phone'] as const),
        r.choose('palace.plazaDir', {}, ['down', 'up', 'left', 'right'] as const), 'citizen', gid, '在喷泉广场上走动的人')) k++;
    return;
  }
  // the lawn: two parterres either side of the axis path; the path is paved from the street to the drive
  for (let y = f.y0; y < f.y1; y++) for (let x = pa; x < pb; x++) c.paved.add(`${x},${y}`);
  sb.zone('block', 'plaza', rect(pa * T, f.y0 * T, pb * T, f.y1 * T), '草坪中间的路：从街上沿宫殿的中轴走到台阶', gid);
  sb.clear(rect(pa * T, f.y0 * T, pb * T, f.y1 * T), 'gwalk', '草坪中间的路：保持畅通', gid);
  const statue = r.choose('palace.lawnStatue', {}, [`${G}Light_Brown_Statue`, `${G}Grey_Statue`, ...variants(`${G}Grass_Statue`, [1, 2, 3, 4, 5, 6])].filter(k => spr(k).h / T <= f.y1 - f.y0 - 1));
  for (const [a, b] of [[f.x0, pa], [pb, f.x1]]) {
    sb.zone('yard', 'palace-lawn', rect(a * T, f.y0 * T, b * T, f.y1 * T), '车道外的草坪：矮树篱围着', gid);
    hedge(sb, 'low', ring(a, f.y0, b, f.y1), false, gid, '草坪四周的矮树篱');
    const s = spr(statue);
    sb.putFoot(statue, (a + b) / 2 * T, Math.round((f.y0 + f.y1) / 2 * T + (s.bb[3] - s.bb[1]) / 2), 'statue', { gid, why: '草坪正中的雕像（两块草坪对称）', depth: 14, ignoreClear: true });
  }
  for (const vx of [pa * T - 2, pb * T + 2]) sb.putFoot(r.choose('palace.lawnUrn', {}, [`${G}Big_Red_Flower_Vase`, `${G}Big_White_Flower_Vase`].filter(hasSprite)), vx, f.y1 * T - 2, 'plant', { gid, why: '路口两边的花瓶', ignoreClear: true, force: true, occupy: false });
}
