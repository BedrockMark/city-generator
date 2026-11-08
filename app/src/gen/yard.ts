// Courtyard / leftover space allocation. Every yard cell gets a purpose: each yard component is cut into
// rectangles (largest first) and each rectangle becomes parking (with a driveway to the street), a garden,
// a forecourt for the building it fronts, a passage, a green strip or a service corner.
// Ground north of a building's footprint is ordinary yard: whether the upper floors cover it in the picture plays
// no part here (D38).
import { Rng } from './rng';
import { paintWalkCell, asphalt, slab, type Layout } from './layout';
import type { BlockPlan, PlacedBuilding } from './block';
import { SceneBuilder, rect } from './place';
import { spr, variants, hasSprite } from './assets';
import { makePerson, frameFor } from './people';
import { person } from './vignettes';
import { TILE, type Anchor } from './types';

const C = '3_City_Props/';
const V = '10_Vehicles/';
const G = '17_Garden/';
const T = TILE;

export type CellRect = { x: number; y: number; w: number; h: number };
type Kind = 'parking' | 'garden' | 'forecourt' | 'passage' | 'strip' | 'service' | 'paved';

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

export function yardSpaces(L: Layout, plan: BlockPlan, sb: SceneBuilder, r: Rng, e06: Rng) {
  const yardStyle = r.choose('yard.paving', {}, ['sidewalk_brown', 'sidewalk_grey', 'sidewalk_beige', 'sidewalk_lightgrey'].filter(s => s !== L.mainStyle));
  const free = plan.yard.map(row => [...row]);
  for (let y = 0; y < L.rows; y++) for (let x = 0; x < L.cols; x++) if (free[y][x]) L.base[y][x] = slab(yardStyle, x, y);
  const isWalk = (x: number, y: number) => L.cls[y]?.[x] === 'walk';
  const used = { parking: 0, garden: 0, service: 0 };
  const rects: { rc: CellRect; kind: Kind; b?: PlacedBuilding; side?: 'N' | 'S' | 'E' | 'W'; why: string }[] = [];
  GRASS = L.cls.map(row => row.map(() => false));
  // ---- cut rectangles, biggest first, across all components ----
  for (let guard = 0; guard < 120; guard++) {
    const avail = (x: number, y: number) => free[y]?.[x] === true;
    const cells: [number, number][] = [];
    for (let y = 0; y < L.rows; y++) for (let x = 0; x < L.cols; x++) if (avail(x, y)) cells.push([x, y]);
    const rc = bestRect(cells, avail);
    if (!rc || rc.w * rc.h < 2) break;
    for (const [x, y] of cellsOf(rc)) free[y][x] = false;
    const sideFrac = (s: 'N' | 'S' | 'E' | 'W') => {
      const line = s === 'N' || s === 'S' ? Array.from({ length: rc.w }, (_, i) => [rc.x + i, s === 'N' ? rc.y - 1 : rc.y + rc.h] as const)
        : Array.from({ length: rc.h }, (_, i) => [s === 'W' ? rc.x - 1 : rc.x + rc.w, rc.y + i] as const);
      return line.filter(([x, y]) => isWalk(x, y)).length / line.length;
    };
    const street = (['S', 'W', 'E', 'N'] as const).filter(s => sideFrac(s) > 0.5);
    // the building whose facade this rect lies in front of
    const fronted = plan.buildings.find(b => b.cy + b.plan.h === rc.y && b.cx < rc.x + rc.w && rc.x < b.cx + b.plan.w);
    let kind: Kind, why: string;
    const size = `${rc.w}×${rc.h} 格`;
    let parkTried = false;
    if (fronted && rc.h <= 3 && street.includes('S')) { kind = 'forecourt'; why = `楼前空地（${size}）：${fronted.plan.id} 立面前退出 ≤3 行、南侧临街，按楼的类型布置`; }
    else if (!used.parking && rc.w >= 9 && rc.h >= 7 && (parkTried = true) && r.choose('yard.parking', { w: rc.w, h: rc.h }, { p: 0.75 }) && parking(L, sb, sb.enter(r.fork(`park${rc.x},${rc.y}`, { w: rc.w, h: rc.h })), rc, plan, free)) { sb.enter(r); used.parking++; continue; }
    else if (Math.min(rc.w, rc.h) >= 3 && rc.w * rc.h >= 15 && used.garden < 2) { kind = 'garden'; used.garden++; why = `花园（${size}）：内院中最短边 ≥3、面积 ≥15 的空地（每街区至多 2 个）${parkTried ? '；没有做成停车场（未抽中或找不到车道）' : ''}`; }
    else if (Math.min(rc.w, rc.h) <= 2 && street.length > 0) {
      kind = rc.w <= 2 && rc.h >= 3 && street.includes('S') && !street.includes('E') && !street.includes('W') ? 'passage' : 'strip';
      why = kind === 'passage' ? `楼间过道（${size}）：1–2 格宽、只向南通到街上，保持通畅，最里面放垃圾桶` : `临街的细长空地（${size}）：绿化带或一排盆栽`;
    }
    else if (Math.max(rc.w, rc.h) >= 3 && Math.min(rc.w, rc.h) <= 3) { kind = 'strip'; why = `细长空地（${size}）：绿化带或一排盆栽`; }
    else if (rc.w * rc.h >= 4 && used.service < 2) { kind = 'service'; used.service++; why = `杂物角（${size}）：不临街的小块空地，放垃圾箱和纸箱（每街区至多 2 个）`; }
    else { kind = 'paved'; why = `零碎空地（${size}）：太小或同类已满，朴素铺地（宁删勿补）`; }
    rects.push({ rc, kind, b: fronted, side: street[0], why });
  }
  // exp-06 (adopted 0.7.5): the cut may split one space into neighbouring gardens; they become one garden, their paths linked
  const blocked = rects.filter(q => q.kind === 'parking' || q.kind === 'passage' || q.kind === 'forecourt').map(q => q.rc);
  const gapOk = (x: number, y: number) => plan.yard[y]?.[x] === true && !blocked.some(q => x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h);
  const join = joinGardens(L, rects.filter(q => q.kind === 'garden'), (rc, side) => ownPath(rc, side, r.fork(`garden${rc.x},${rc.y}`)), e06, gapOk);
  let mergedGid: string | undefined;
  if (join) {
    const ra = rects.find(q => q.rc === join.a)!, c = { x: (join.a.x + join.a.w / 2) * T, y: (join.a.y + join.a.h / 2) * T };
    mergedGid = sb.group('garden', `${ra.why}；与相邻的花园合成一个，小路连通`, { anchor: { kind: 'yard', ref: `garden@${join.a.x},${join.a.y}`, x: c.x, y: c.y } });
    // the link is kept clear before anything in the yard is placed (the gap may be a green strip)
    const k = join.link;
    if (k) sb.clear(k.w === 1 ? rect(k.x * T + 2, k.y * T, (k.x + 1) * T - 2, (k.y + k.h) * T) : rect(k.x * T, k.y * T + 2, (k.x + k.w) * T, (k.y + 1) * T - 2),
      'path', '花园小路的连接段：把相邻两半边花园的小路接起来', mergedGid);
  }
  for (const { rc, kind, b, side, why } of rects) {
    const shared = join && (rc === join.a || rc === join.b) ? join : undefined;
    const emit = () => {
      const rr = sb.enter(r.fork(`${kind}${rc.x},${rc.y}`, { kind, w: rc.w, h: rc.h, street: side ?? '' }));
      const px = rect(rc.x * T, rc.y * T, (rc.x + rc.w) * T, (rc.y + rc.h) * T);
      const gid = shared ? mergedGid! : sb.group(kind, why, kind === 'forecourt' ? { id: b!.plan.id, anchor: { kind: 'door', ref: `${b!.plan.id}.door`, x: b!.cx * T + (b!.plan.doors[0] ?? b!.plan.w * T / 2), y: (b!.cy + b!.plan.h) * T } }
        : { anchor: { kind: 'yard', ref: `${kind}@${rc.x},${rc.y}`, x: px.x0 + (px.x1 - px.x0) / 2, y: px.y0 + (px.y1 - px.y0) / 2 } });
      sb.zone('yard', kind, px, shared ? `${why}；和相邻的花园是同一个花园，小路连通` : why, gid);
      if (kind === 'garden') garden(L, sb, rr, rc, side, plan, gid, shared);
      else if (kind === 'forecourt') forecourt(L, sb, rr, rc, b!, gid);
      else if (kind === 'passage') passage(sb, rr, rc, gid);
      else if (kind === 'strip') strip(L, sb, rr, rc, side, plan, gid);
      else if (kind === 'service') service(sb, rr, rc, gid);
      else if (kind === 'paved' && rc.w * rc.h >= 2 && rr.choose('paved.pot', {}, { p: 0.5 })) sb.putFoot(rr.choose('paved.potModel', {}, variants('17_Garden/Bush_Potted')), (rc.x + 0.5) * T, (rc.y + 1) * T - 2, 'plant', { gid, why: '零碎空地上的一盆盆栽' });
    };
    emit();
  }
  // exp-06: the link is paved last, in the paving of the bigger garden's path (strips in the gap may have planted it)
  if (join?.link) for (const [x, y] of cellsOf(join.link)) { GRASS[y][x] = false; L.base[y][x] = slab(join.style!, x, y); }
  paintGrass(L);
}

// ------------------------------------------------------------------------------------------------
// parking lot with a driveway

type Drive = { cells: [number, number][]; side: 'N' | 'S' | 'E' | 'W'; at: number };

/** a 2-cell-wide driveway from the lot edge through yard / sidewalk cells to the road (shortest wins) */
function findDrive(L: Layout, plan: BlockPlan, rc: CellRect, bayCols: (c: number) => boolean): Drive | null {
  const passable = (x: number, y: number) => {
    const c = L.cls[y]?.[x];
    if (c === 'walk') return 'walk';
    if (c === 'lot' && plan.yard[y][x]) return 'lot';
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
  const leftAlign = rr.choose('parking.alignLeft', {}, { p: 0.5 });
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
  const mouth = drive.cells.reduce((m, c) => (drive.side === 'S' ? c[1] > m[1] : drive.side === 'N' ? c[1] < m[1] : drive.side === 'E' ? c[0] > m[0] : c[0] < m[0]) ? c : m, drive.cells[0]);
  const why = `停车场（${rc.w}×${rc.h} 格）：内院里 ≥9×7 的空地，找到一条通到马路的 2 格宽车道（向${{ N: '北', S: '南', E: '东', W: '西' }[drive.side]}，D19）`;
  const gid = sb.group('parking', why, { anchor: { kind: 'yard', ref: 'driveway', x: (mouth[0] + 0.5) * T, y: (mouth[1] + 0.5) * T } });
  sb.zone('yard', 'parking', rect(rc.x * T, rc.y * T, (rc.x + rc.w) * T, (rc.y + rc.h) * T), why, gid);
  sb.zone('yard', 'driveway', rect(dx0 * T, dy0 * T, dx1 * T, dy1 * T), '停车场车道：穿过人行道通到马路，路缘在这里断开（D19）', gid);
  sb.clear(rect((dx0 + grow[0]) * T - 6, (dy0 + grow[1]) * T - 6, (dx1 + grow[2]) * T + 6, (dy1 + grow[3]) * T + 6), 'drive', '车道和车道口：车要进出，不停车、不放路缘设施', gid);
  // aisle stays clear
  sb.clear(rect(rc.x * T, (rc.y + 5) * T, (rc.x + rc.w) * T, (rc.y + rc.h) * T), 'aisle', '停车场通道：车进出车位的地方保持畅通', gid);
  const carsKeys = variants(V + 'Car_Down').filter(k => spr(k).w <= 48 && spr(k).h <= 80);
  for (let p = 0; p < nPieces; p++) for (let b = 0; b < 3; b++) {
    if (!rr.choose('parking.bayTaken', {}, { p: 0.6 })) continue;
    const cx = (px0 + p * 9 + 1.5 + b * 3) * T, by = (rc.y + 5) * T - 3;
    sb.putFoot(rr.choose('parking.carModel', {}, carsKeys), cx, by, 'vehicle', { gid, why: '停在车位里的车（车头朝通道）', anchor: { kind: 'yard', ref: `bay${p * 3 + b}`, x: cx, y: by }, depth: 40, ignoreClear: true });
  }
  // someone walking to their car
  if (rr.choose('parking.walker', {}, { p: 0.6 })) {
    const p = makePerson(rr, 'citizen');
    sb.putChar(p.layers, frameFor(p, 'walk', rr.choose('parking.walkerDir', {}, ['left', 'right'] as const), rr), (rc.x + rr.int(1, rc.w - 2)) * T, (rc.y + 6) * T + 4, 'citizen', { gid, why: '在停车场通道里走向自己车的人' });
  }
  return true;
}

// ------------------------------------------------------------------------------------------------

/** lawn cells of the block; painted once at the end so touching lawns merge */
let GRASS: boolean[][] = [];
function grass(L: Layout, rc: CellRect) {
  void L;
  for (let y = rc.y; y < rc.y + rc.h; y++) for (let x = rc.x; x < rc.x + rc.w; x++) GRASS[y][x] = true;
}
/** grass 9-slice (1_Terrains cols 0-2, rows 11-13, transparent edges), edge pieces chosen from the lawn's neighbours */
function paintGrass(L: Layout) {
  const g = (x: number, y: number) => GRASS[y]?.[x] === true;
  for (let y = 0; y < L.rows; y++) for (let x = 0; x < L.cols; x++) {
    if (!g(x, y)) continue;
    const l = g(x - 1, y), r = g(x + 1, y), u = g(x, y - 1), d = g(x, y + 1);
    L.over[y][x] = ['terr', !l && r ? 0 : l && !r ? 2 : 1, !u && d ? 11 : u && !d ? 13 : 12];
  }
}

export const EXP06 = 'exp-06';
type Side = 'N' | 'S' | 'E' | 'W';
type PathLine = { vertical: boolean; at: number };
/** exp-06: how two neighbouring gardens become one. Each keeps its own path, except that a path crossing the side
 *  facing the other garden is lined up with the link; the link runs along one line from one path to the other, through
 *  the gap between them if there is one (T junctions where it meets a path running the other way) */
export type Join = { a: CellRect; b: CellRect; pa: PathLine; pb: PathLine; link?: CellRect; style?: string };

/** the path a garden draws for itself (one draw: its stream keeps its numbers whatever is done with it) */
function ownPath(rc: CellRect, side: Side | undefined, rr: Rng): PathLine {
  const vertical = side ? side === 'N' || side === 'S' : rc.h > rc.w;
  const len = vertical ? rc.w : rc.h;
  return { vertical, at: (vertical ? rc.x : rc.y) + Math.max(1, Math.min(len - 2, Math.floor(len / 2) + rr.int(-1, 1))) };
}

/** C20 would call this stretch of path redundant: every point of it has sidewalk within 40px to one side */
function besideWalk(L: Layout, vertical: boolean, at: number, from: number, to: number): boolean {
  const mid = at * T + T / 2;
  for (let a = from * T + 8; a < to * T; a += 16) {
    let near = false;
    for (let d = 8; d <= 40 && !near; d += 4) for (const sgn of [-1, 1]) {
      const [px, py] = vertical ? [mid + sgn * d, a] : [a, mid + sgn * d];
      const c = L.cls[Math.floor(py / T)]?.[Math.floor(px / T)];
      if (c === 'walk' || c === 'nwalk') { near = true; break; }
    }
    if (!near) return false;
  }
  return true;
}

/** exp-06: the first two gardens at most 2 cells apart, facing each other along a stretch with room for a path,
 *  the gap between them free yard (`gapOk`); null = left apart */
export function joinGardens(L: Layout, gs: { rc: CellRect; side?: Side }[], own: (rc: CellRect, side?: Side) => PathLine, e06: Rng,
  gapOk: (x: number, y: number) => boolean = () => true): Join | null {
  for (let i = 0; i < gs.length; i++) for (let j = i + 1; j < gs.length; j++) {
    const a = gs[i].rc, b = gs[j].rc;
    // cross: the link is a vertical line (one garden above the other); u = across the line, v = along it
    for (const cross of [true, false]) {
      const [au, aw, bu, bw] = cross ? [a.x, a.w, b.x, b.w] : [a.y, a.h, b.y, b.h];
      const [av, ah, bv, bh] = cross ? [a.y, a.h, b.y, b.h] : [a.x, a.w, b.x, b.w];
      const first = av < bv ? 'a' : 'b';
      const gap = first === 'a' ? bv - (av + ah) : av - (bv + bh);
      if (gap < 0 || gap > 2) continue;
      // a line inside both, one cell in from their edges (as a garden keeps its path)
      const lo = Math.max(au, bu) + 1, hi = Math.min(au + aw, bu + bw) - 2;
      if (hi < lo) continue;
      const oa = own(a, gs[i].side), ob = own(b, gs[j].side);
      const clamp = (n: number) => Math.max(lo, Math.min(hi, n));
      // the bigger garden's path sets the line when it crosses toward the other; then the other's; else drawn
      const at = oa.vertical === cross ? clamp(oa.at) : ob.vertical === cross ? clamp(ob.at)
        : e06.choose('garden.joinAt', { cross }, Array.from({ length: hi - lo + 1 }, (_, k) => lo + k));
      const pa = oa.vertical === cross ? { vertical: cross, at } : oa, pb = ob.vertical === cross ? { vertical: cross, at } : ob;
      // the link, along v: from the upper / left garden's path (its far edge if that path runs along the line) to the other's
      const [p, q] = first === 'a' ? [{ rc: a, v: av, h: ah, path: pa }, { rc: b, v: bv, h: bh, path: pb }] : [{ rc: b, v: bv, h: bh, path: pb }, { rc: a, v: av, h: ah, path: pa }];
      const v0 = p.path.vertical === cross ? p.v + p.h : p.path.at + 1;
      const v1 = q.path.vertical === cross ? q.v : q.path.at;
      const link = v1 > v0 ? (cross ? { x: at, y: v0, w: 1, h: v1 - v0 } : { x: v0, y: at, w: v1 - v0, h: 1 }) : undefined;
      // the gap is crossed only over free yard
      const gapCells = Array.from({ length: gap }, (_, k) => (first === 'a' ? av + ah : bv + bh) + k);
      if (!gapCells.every(g => (cross ? gapOk(at, g) : gapOk(g, at)))) continue;
      // C20 would turn a path or the link back into lawn and cut the garden in two again: leave these apart
      const span = (rc: CellRect, v: boolean) => (v ? [rc.y, rc.y + rc.h] : [rc.x, rc.x + rc.w]) as [number, number];
      // (an unmoved path too: the link would lead to a path C20 removes, 64)
      if (besideWalk(L, pa.vertical, pa.at, ...span(a, pa.vertical))) continue;
      if (besideWalk(L, pb.vertical, pb.at, ...span(b, pb.vertical))) continue;
      if (link && besideWalk(L, cross, at, ...span(link, cross))) continue;
      return { a, b, pa, pb, link };
    }
  }
  return null;
}

const SMALL_TREES = [C + 'Tree_1', C + 'Tree_2', C + 'Tree_3', C + 'Tree_4', C + 'Tree_8'];

/** a little park: grass split by a path from the street gate, benches facing the path, trees on the grass */
function garden(L: Layout, sb: SceneBuilder, rr: Rng, rc: CellRect, side: Side | undefined, plan: BlockPlan, gid: string, join?: Join) {
  // exp-06: a garden joined to its neighbour may have its path lined up with the link; its own draws still happen
  const own = ownPath(rc, side, rr);
  const { vertical, at: pathAt } = join ? (rc === join.a ? join.pa : join.pb) : own;
  const halves: CellRect[] = vertical
    ? [{ x: rc.x, y: rc.y, w: pathAt - rc.x, h: rc.h }, { x: pathAt + 1, y: rc.y, w: rc.x + rc.w - pathAt - 1, h: rc.h }]
    : [{ x: rc.x, y: rc.y, w: rc.w, h: pathAt - rc.y }, { x: rc.x, y: pathAt + 1, w: rc.w, h: rc.y + rc.h - pathAt - 1 }];
  const ownStyle = rr.choose('garden.pathPaving', {}, ['sidewalk_beige', 'sidewalk_lightbeige', 'sidewalk_brown']);
  // the bigger garden is laid first; the other one continues in its paving
  const pathStyle = join?.style ?? ownStyle;
  if (join && rc === join.a) join.style = ownStyle;
  if (vertical) for (let y = rc.y; y < rc.y + rc.h; y++) L.base[y][pathAt] = slab(pathStyle, pathAt, y);
  else for (let x = rc.x; x < rc.x + rc.w; x++) L.base[pathAt][x] = slab(pathStyle, x, pathAt);
  for (const h of halves) if (h.w > 0 && h.h > 0) grass(L, h);
  // path stays walkable
  const pathR = vertical ? rect(pathAt * T + 2, rc.y * T, (pathAt + 1) * T - 2, (rc.y + rc.h) * T) : rect(rc.x * T, pathAt * T + 2, (rc.x + rc.w) * T, (pathAt + 1) * T - 2);
  sb.clear(pathR, 'path', '花园小路：从街边入口穿过花园，保持畅通', gid);
  const pathAnchor: Anchor = { kind: 'yard', ref: `${gid}/path`, x: (pathR.x0 + pathR.x1) / 2, y: (pathR.y0 + pathR.y1) / 2 };
  // benches face the path with their sitters; one style per garden
  const nB = rr.count('garden.benches', {}, 1, 2);
  let prevSide = rr.choose('garden.benchSide', {}, { p: 0.5 });
  for (let i = 0; i < nB; i++) {
    if (vertical) {
      const leftSide = i === 0 ? prevSide : !prevSide;
      const by = (rc.y + rr.int(1, Math.max(1, rc.h - 3))) * T + 44;
      if (by > (rc.y + rc.h) * T) continue;
      const key = leftSide ? rr.choose('garden.benchModel', { faces: 'right' }, [C + 'Bench_4', C + 'Bench_6']) : rr.choose('garden.benchModel', { faces: 'left' }, [C + 'Bench_3', C + 'Bench_5']);
      const bx = leftSide ? pathAt * T - 8 : (pathAt + 1) * T + 8;
      if (sb.putFoot(key, bx, by, 'bench', { gid, why: '小路旁的长椅，面朝小路（D21）', anchor: pathAnchor }) && rr.choose('garden.sitter', {}, { p: 0.6 }))
        { const p = makePerson(rr, 'resident'); sb.putChar(p.layers, frameFor(p, 'sit', leftSide ? 'right' : 'left'), bx + (leftSide ? 1 : -1), by - 12, 'resident', { gid, why: '坐在长椅上的住户，面朝小路', anchor: { kind: 'object', ref: `${gid}/bench${i}`, x: bx, y: by }, force: true }); }
    } else {
      const above = i === 0 ? prevSide : !prevSide;
      const bx = (rc.x + rr.int(1, Math.max(1, rc.w - 3))) * T + 16;
      const key = above ? rr.choose('garden.benchModel', { faces: 'down' }, [C + 'Bench_1', C + 'Bench_2']) : C + 'Bench_7';
      const by = above ? pathAt * T - 1 : (pathAt + 1) * T + 30;
      if (by > (rc.y + rc.h) * T + 2 || by - 30 < rc.y * T) continue;
      sb.putFoot(key, bx, by, 'bench', { gid, why: '小路旁的长椅，面朝小路（D21）', anchor: pathAnchor });
    }
  }
  // trees on the grass, irregular but spaced
  const trees = SMALL_TREES.filter(hasSprite);
  const nT = Math.max(1, Math.round(rc.w * rc.h / 12));
  for (let i = 0, ok = 0; i < nT * 4 && ok < nT; i++) {
    const h = rr.choose('garden.treeHalf', {}, halves); if (h.w < 1 || h.h < 2) continue;
    const fx = (h.x + rr.range(0.5, h.w - 0.5)) * T, fy = (h.y + rr.int(2, h.h)) * T - rr.int(3, 10);
    if (sb.putFoot(rr.choose('garden.treeModel', {}, trees), fx, fy, 'tree', { gid, why: `草坪上的小树（约每 12 格一棵，彼此留空）`, pad: 6 })) ok++;
  }
  for (let i = 0; i < rr.count('garden.flowers', {}, 0, 3); i++) { const h = rr.choose('garden.flowerHalf', {}, halves); if (h.w >= 2 && h.h >= 1) sb.putFoot(rr.choose('garden.flowerModel', {}, variants(C + 'Flower_Bush')), (h.x + rr.int(1, h.w - 1)) * T, (h.y + rr.int(1, h.h)) * T - 2, 'plant', { gid, why: '草坪上的花丛' }); }
  if (rr.choose('garden.kid', {}, { p: 0.4 })) { const p = makePerson(rr, 'kid', { kid: true }); const h = rr.choose('garden.kidHalf', {}, halves); if (h.w > 0 && h.h > 0) sb.putChar(p.layers, frameFor(p, 'stand', rr.choose('garden.kidDir', {}, ['down', 'left', 'right'] as const)), (h.x + rr.range(0.5, h.w - 0.5)) * T, (h.y + rr.int(1, h.h)) * T - 2, 'kid', { gid, why: '在草坪上玩的孩子' }); }
  if (rr.choose('garden.walker', {}, { p: 0.5 })) { const p = makePerson(rr, 'citizen'); const q = (vertical ? rc.y : rc.x) + rr.int(0, (vertical ? rc.h : rc.w) - 1);
    const [fx, fy] = vertical ? [(pathAt + 0.5) * T, (q + 1) * T - 3] : [(q + 0.5) * T, (pathAt + 1) * T - 3];
    sb.putChar(p.layers, frameFor(p, 'walk', vertical ? rr.choose('garden.walkerDir', { vertical }, ['up', 'down'] as const) : rr.choose('garden.walkerDir', { vertical }, ['left', 'right'] as const), rr), fx, fy, 'citizen', { gid, why: '沿花园小路走的人', anchor: pathAnchor }); }
  if (side) fence(L, sb, rr, rc, side, pathAt, vertical, plan, gid);
}

/** fence along the street side(s), opening where the path meets the street */
function fence(L: Layout, sb: SceneBuilder, rr: Rng, rc: CellRect, side: 'N' | 'S' | 'E' | 'W', pathAt: number, vertical: boolean, plan: BlockPlan, gid: string) {
  if (!rr.choose('garden.fence', { side }, { p: 0.7 })) return;
  const set = rr.choose('garden.fenceStyle', {}, [1, 2, 3, 4, 5, 6]);
  const F = (part: string) => `24_Additional_Houses/24_Fence_${set}_${part}`;
  const why = `花园临街一侧（${{ N: '北', S: '南', E: '东', W: '西' }[side]}）的围栏，小路处留出入口`;
  const put = (key: string, x: number, y: number) => { if (hasSprite(key)) sb.putAt(key, x * T, y * T, 'fence', { gid, why, depth: 6, ignoreClear: true }); };
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
function forecourt(L: Layout, sb: SceneBuilder, rr: Rng, rc: CellRect, b: PlacedBuilding, g: string) {
  const door = b.cx * T + (b.plan.doors[0] ?? b.plan.w * T / 2);
  const paved = b.plan.front !== 'condo' && b.plan.front !== 'house';
  for (const [x, y] of cellsOf(rc)) L.base[y][x] = slab(paved ? L.mainStyle : 'sidewalk_lightgrey', x, y);
  sb.clear(rect(door - 12, rc.y * T, door + 12, (rc.y + rc.h) * T), 'door', `${b.plan.id} 门前穿过楼前空地的通道`, g);
  const x0 = rc.x * T, x1 = (rc.x + rc.w) * T, y1 = (rc.y + rc.h) * T;
  switch (b.plan.front) {
    case 'cafe': case 'bakery': {
      // terrace: tables with chairs and customers filling the setback
      const table = rr.choose('forecourt.tableModel', {}, variants(V + 'Street_Food_Table'));
      for (let tx = x0 + 18; tx < x1 - 14; tx += rr.int(36, 44)) {
        const ty = rc.y * T + (rc.h >= 2 ? rr.int(22, 26) : 14);
        if (!sb.putFoot(table, tx, ty, 'table', { gid: g, why: '餐饮店退后形成的露天座位区里的桌子' })) continue;
        const anchor: Anchor = { kind: 'object', ref: `${g}/table@${tx}`, x: tx, y: ty };
        for (const [sx, dir] of [[-12, 'right'], [12, 'left']] as const) {
          if (rr.choose('forecourt.seatTaken', {}, { p: 0.55 })) { const p = makePerson(rr, 'customer', { kid: false }); if (!sb.putChar(p.layers, frameFor(p, 'sit', dir, rr), tx + sx, ty - 1, 'customer', { gid: g, why: '坐在桌旁的顾客，面朝桌子', anchor })) sb.putFoot(V + 'Street_Food_Chair_1', tx + sx, ty - 2, 'chair', { gid: g, why: '桌旁的椅子', anchor }); }
          else sb.putFoot(V + 'Street_Food_Chair_1', tx + sx, ty - 2, 'chair', { gid: g, why: '桌旁的空椅子', anchor });
        }
      }
      break;
    }
    case 'retail': case 'hardware': case 'market': case 'gym': case 'closed': case 'office': case 'hotel': {
      // planters framing the entrance, a bench, sale crates / boxes on display, browsing customers
      const pot = rr.choose('forecourt.potModel', {}, variants('17_Garden/Bush_Potted'));
      for (let x = x0 + 8; x < x1; x += rr.int(28, 48)) sb.putFoot(pot, x, y1 - 3, 'plant', { gid: g, why: '楼前空地临街边缘的一排盆栽，框出店门前的空间' });
      if (rr.choose('forecourt.bench', {}, { p: 0.6 })) sb.putFoot(C + 'Bench_1', door + (rr.choose('forecourt.benchRight', {}, { p: 0.5 }) ? 34 : -34), rc.y * T + 28, 'bench', { gid: g, why: '店门旁的长椅，面朝街道' });
      if (!['gym', 'office', 'hotel'].includes(b.plan.front) && rr.choose('forecourt.crates', {}, { p: 0.6 })) for (let i = 0; i < rr.count('forecourt.crateCount', {}, 1, 3); i++) sb.putFoot(rr.choose('forecourt.crateModel', {}, variants('6_Garage_Sales/Box')), door + (rr.choose('forecourt.crateRight', {}, { p: 0.5 }) ? 1 : -1) * rr.int(24, 56), rc.y * T + 14, 'crate', { gid: g, why: '摆在店门两侧的货箱（门口展示）' });
      for (let i = 0; i < rr.count('forecourt.customers', {}, 0, 2); i++) person(sb, rr, door + rr.int(-40, 40), rc.y * T + rr.int(14, 24), 'stand', 'up', 'customer', g, '在店门前的顾客，面朝店门');
      break;
    }
    default: {
      // front garden: lawn either side of the door path, flowers along the facade, mailbox at the path
      const dc = Math.floor(door / T);
      if (dc - 1 >= rc.x) grass(L, { x: rc.x, y: rc.y, w: dc - rc.x, h: rc.h });
      if (dc + 1 < rc.x + rc.w) grass(L, { x: dc + 1, y: rc.y, w: rc.x + rc.w - dc - 1, h: rc.h });
      const fl = rr.choose('forecourt.flowerModel', {}, variants(C + 'Flower_Bush'));
      for (let x = x0 + 14; x < x1 - 8; x += rr.int(30, 44)) sb.putFoot(fl, x, rc.y * T + 14, 'plant', { gid: g, why: '住宅前院沿立面的花丛' });
      if (rr.choose('forecourt.mailbox', {}, { p: 0.6 })) sb.putFoot(C + 'Mailbox_1', door + 18, y1 - 2, 'utility', { gid: g, why: '前院小路口的信箱' });
      if (rr.choose('forecourt.tree', {}, { p: 0.4 })) sb.putFoot(rr.choose('forecourt.treeModel', {}, SMALL_TREES), rr.choose('forecourt.treeLeft', {}, { p: 0.5 }) ? x0 + 10 : x1 - 10, y1 - 3, 'tree', { gid: g, why: '前院角上的小树' });
    }
  }
}

/** narrow way between buildings: kept clear; a bin pushed against the wall at the far end, maybe laundry */
function passage(sb: SceneBuilder, rr: Rng, rc: CellRect, gid: string) {
  const x0 = rc.x * T, x1 = (rc.x + rc.w) * T;
  sb.clear(rect(x0 + 2, (rc.y + 1) * T, x1 - 2, (rc.y + rc.h) * T + 2 * T), 'passage', '楼间过道的通行线：从街上走进来的路保持畅通', gid);
  const top = rc.y * T + 14;
  if (rc.h >= 4 && rr.choose('passage.bin', {}, { p: 0.7 })) sb.putFoot(rr.choose('passage.binModel', {}, variants(C + 'Trashbin')), rc.w >= 2 ? x0 + 8 : x0 + 8, top, 'trash', { gid, why: '过道最里面贴墙的垃圾桶（不挡路）', ignoreClear: true });
  if (rc.w >= 2 && rr.choose('passage.litter', {}, { p: 0.5 })) sb.putFoot(rr.choose('passage.litterModel', {}, variants(C + 'Trash')), x1 - 6, top + 4, 'trash', { gid, why: '过道尽头的垃圾袋', ignoreClear: true });
  if (rr.choose('passage.person', {}, { p: 0.25 })) person(sb, rr, x0 + rc.w * 8, (rc.y + rr.int(1, rc.h - 1)) * T + 8, 'phone', 'down', 'citizen', gid, '躲进过道打电话的人');
}

/** green strip: lawn with a hedge row / shrubs / small trees, or a row of potted plants on a narrow paved strip */
function strip(L: Layout, sb: SceneBuilder, rr: Rng, rc: CellRect, side: 'N' | 'S' | 'E' | 'W' | undefined, plan: BlockPlan, gid: string) {
  void plan;
  const horiz = rc.w >= rc.h;
  if (Math.min(rc.w, rc.h) === 1 && rr.choose('strip.pots', {}, { p: 0.5 })) {
    const pot = rr.choose('strip.potModel', {}, variants('17_Garden/Bush_Potted'));
    if (horiz) for (let x = rc.x * T + 8; x < (rc.x + rc.w) * T - 4; x += rr.int(24, 40)) sb.putFoot(pot, x, (rc.y + 1) * T - 2, 'plant', { gid, why: '1 格宽的空地：一排盆栽' });
    else for (let y = (rc.y + 1) * T - 2; y <= (rc.y + rc.h) * T; y += rr.int(24, 40)) sb.putFoot(pot, (rc.x + 0.5) * T, y, 'plant', { gid, why: '1 格宽的空地：一排盆栽' });
    return;
  }
  grass(L, rc);
  const shrubs = horiz ? ['Bush_14', 'Bush_15', 'Bush_18', 'Bush_19', 'Bush_22'].map(k => G + k) : ['Bush_16', 'Bush_17', 'Bush_10', 'Bush_11'].map(k => G + k);
  const pool = [...shrubs.filter(hasSprite), ...(Math.min(rc.w, rc.h) >= 2 ? SMALL_TREES.filter(hasSprite) : [])];
  const L0 = horiz ? rc.x * T : rc.y * T, L1 = horiz ? (rc.x + rc.w) * T : (rc.y + rc.h) * T;
  for (let s = L0 + rr.int(6, 18); s < L1 - 6; s += rr.int(20, 44)) {
    const key = rr.choose('strip.plantModel', {}, pool);
    const [fx, fy] = horiz ? [s, (rc.y + rc.h) * T - rr.int(3, 8)] : [(rc.x + rc.w / 2) * T + rr.jitter(3), s + 16];
    sb.putFoot(key, fx, fy, key.includes('Tree') ? 'tree' : 'plant', { gid, why: '绿化带草坪上的灌木 / 小树', pad: 2 });
  }
  void side;
}

/** service corner: dumpsters against the back edge, bags, boxes */
function service(sb: SceneBuilder, rr: Rng, rc: CellRect, gid: string) {
  const nd = Math.min(rr.count('service.dumpsters', {}, 1, 3), Math.max(1, Math.floor(rc.w / 2)));
  const x0 = rc.x * T, y = rc.y * T + 30;
  for (let i = 0; i < nd; i++) sb.putFoot(rr.choose('service.dumpsterModel', {}, variants(C + 'Dumpster')), x0 + 16 + i * 32, Math.min(y, (rc.y + rc.h) * T - 2), 'trash', { gid, why: '杂物角靠后的大垃圾箱' });
  for (let i = 0; i < rr.count('service.bags', {}, 1, 3); i++) sb.putFoot(rr.choose('service.bagModel', {}, variants(C + 'Trash')), x0 + rr.int(4, Math.max(5, rc.w * T - 4)), (rc.y + rc.h) * T - rr.int(2, 8), 'trash', { gid, why: '垃圾箱前的垃圾袋' });
  if (rr.choose('service.box', {}, { p: 0.5 })) sb.putFoot(rr.choose('service.boxModel', {}, variants('6_Garage_Sales/Box')), x0 + rr.int(8, Math.max(9, rc.w * T - 8)), (rc.y + rc.h) * T - 2, 'crate', { gid, why: '堆在杂物角的纸箱' });
}
