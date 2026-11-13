// Street cuts and blocks: each arterial cell is split recursively by 5-cell streets until every piece is a block
// whose lot fits the zone's target size. Every random draw is hash*(seed, 'cut', i, j, path, ...), so a cell's
// blocks depend only on (seed, i, j) and can be computed locally in any order. A special district (hash*(seed, 'district',
// i, j, ...)) first takes a corner of the cell, its footprint sized by campusFor (v0.8.2).
import { hash01, hashInt, hashPick } from './hash';
import { cellRect, cellAt } from './arterials';
import { zoneAt, zoneValue, ZONE_NAME } from './zone';
import { ZONES, LOT_RANGE, P_LO, P_HI, CENTRE_MIN, DISTRICT_CHANCE, DISTRICT_WEIGHTS, STREET_WIDTH, JOG_CHANCE, JOG_STEP, JOG_AT, JOG_GAP, LEAF_CHANCE, CELL_CACHE, ISLAND_CHANCE, ISLAND_LOT, ISLAND_ARM } from './config';
import { roundabout, roundaboutAt, islandBlock, rbClass, type Roundabout } from './roundabout';
import { campusFor, DISTRICTS, type DistrictKind } from '../gen/district';
import type { BlockRec, Rect, ZoneKind } from './types';

export type Range = readonly [number, number];
type Axis = 'v' | 'h';                 // 'v' = vertical street (splits the width), 'h' = horizontal street

export { ZONE_NAME };

const inR = (n: number, r: Range) => n >= r[0] && n <= r[1];

/** Can a length be filled by n >= 1 pieces in range r separated by (n - 1) streets? */
export function feasible(len: number, r: Range): boolean {
  for (let n = 1; n * r[0] + (n - 1) * STREET_WIDTH <= len; n++) {
    if (len <= n * r[1] + (n - 1) * STREET_WIDTH) return true;
  }
  return false;
}

/** Can a jogged side be filled: n >= 0 rect pieces, then one L-shaped leaf whose narrow part takes what is left
 *  and whose wide part is `dd` cells wider (both within r)? `len` is the side's narrow extent. */
function feasibleL(len: number, dd: number, r: Range): boolean {
  for (let n = 0; n * (r[0] + STREET_WIDTH) + r[0] <= len; n++) {
    if (len <= n * (r[1] + STREET_WIDTH) + r[1] - dd) return true;
  }
  return false;
}

/** Cut offsets a (piece [0, a), street [a, a + STREET), rest [a + STREET, len)) where the near piece is a feasible
 *  rect and the rest passes `ok`. */
function cutPositions(len: number, r: Range, ok: (rest: number) => boolean): number[] {
  const out: number[] = [];
  for (let a = r[0]; a <= len - STREET_WIDTH - r[0]; a++) if (feasible(a, r) && ok(len - a - STREET_WIDTH)) out.push(a);
  return out;
}

// Rect from coordinates across the cut (u) and along it (v).
const mk = (axis: Axis, u0: number, u1: number, v0: number, v1: number): Rect =>
  axis === 'v' ? { x0: u0, x1: u1, y0: v0, y1: v1 } : { x0: v0, x1: v1, y0: u0, y1: u1 };

// An L-shaped piece left by a jogged street of orientation `axis`: straight edge at u = s, jogged edge at u = e[0]
// for v in [v0, vt) and e[1] for v in [vt, v1). `lo` = the jogged edge is on the low-u side of the piece.
interface LPiece { axis: Axis; lo: boolean; s: number; e: [number, number]; v0: number; v1: number; vt: number }

interface Ctx { seed: string; i: number; j: number; zone: ZoneKind; fw: Range; fh: Range; sw: 2 | 3; out: BlockRec[]; rbs: Rect[] }

const hits = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

function leaf(c: Ctx, path: string, foot: Rect[], why: string[], shape: BlockRec['shape'] = foot.length > 1 ? 'jog' : 'rect',
  extra?: { district?: DistrictKind }): void {
  const id = `b${c.i},${c.j}/${path}`;
  const rec: BlockRec = {
    id, cell: [c.i, c.j], foot, sw: c.sw, zone: c.zone,
    paving: hashPick(c.seed, ZONES[c.zone].paving, 'blk', id),
    shape, why,
  };
  if (extra?.district) rec.district = extra.district;
  // a big plain rect block keeps its middle for a plaza (garden in residential areas; downtown counts as mixed); a
  // district block is its campus, all of it
  if (shape === 'rect' && !rec.district) {
    const w = foot[0].x1 - foot[0].x0 - 2 * c.sw, h = foot[0].y1 - foot[0].y0 - 2 * c.sw;
    if (w >= CENTRE_MIN.w && h >= CENTRE_MIN.h) {
      rec.centre = c.zone === 'residential' ? 'garden' : 'plaza';
      why.push(`地块 ${w}×${h} ≥ ${CENTRE_MIN.w}×${CENTRE_MIN.h}，中心留出${rec.centre === 'garden' ? '中庭' : '广场'}`);
    }
  }
  c.out.push(rec);
}

/** A finished rect block, maybe with a corner cut off by a short L-shaped street (as single-block mode's notch shape,
 *  user 0.8.1-hotfix1: 原本的岛台消失了): the corner becomes an island block `<path>I`, the rest an L-shaped block
 *  whose arms keep room for buildings. False: no notch (not drawn, or the block is too small). */
function notch(c: Ctx, r: Rect, path: string, why: string[]): boolean {
  const { seed, i, j, sw } = c;
  if (hash01(seed, 'cut', i, j, path, 'island') >= ISLAND_CHANCE) return false;
  const w = r.x1 - r.x0, h = r.y1 - r.y0;
  const lw = hashInt(seed, ISLAND_LOT.w[0], ISLAND_LOT.w[1], 'cut', i, j, path, 'islandw');
  const lh = hashInt(seed, ISLAND_LOT.h[0], ISLAND_LOT.h[1], 'cut', i, j, path, 'islandh');
  const iw = lw + 2 * sw, ih = lh + 2 * sw, nw = iw + STREET_WIDTH, nh = ih + STREET_WIDTH;
  if (w - nw - 2 * sw < ISLAND_ARM.w || h - nh - 2 * sw < ISLAND_ARM.h) return false;
  const corner = hashInt(seed, 0, 3, 'cut', i, j, path, 'islandcorner'), east = (corner & 1) === 1, south = (corner & 2) === 2;
  const island: Rect = { x0: east ? r.x1 - iw : r.x0, x1: east ? r.x1 : r.x0 + iw, y0: south ? r.y1 - ih : r.y0, y1: south ? r.y1 : r.y0 + ih };
  // no notch island on a roundabout corner: the roundabout cuts that corner round already
  const grown: Rect = { x0: island.x0 - 1, x1: island.x1 + 1, y0: island.y0 - 1, y1: island.y1 + 1 };
  if (c.rbs.some(q => hits(grown, q))) return false;
  // the rest: the full-width band away from the island, and beside the notch the part it leaves (top to bottom)
  const yc = south ? r.y1 - nh : r.y0 + nh;
  const side: Rect = { x0: east ? r.x0 : r.x0 + nw, x1: east ? r.x1 - nw : r.x1, y0: south ? yc : r.y0, y1: south ? r.y1 : yc };
  const band: Rect = { x0: r.x0, x1: r.x1, y0: south ? r.y0 : yc, y1: south ? yc : r.y1 };
  const where = `${south ? '南' : '北'}${east ? '东' : '西'}角`;
  const nwhy = `${sizeWhy(c, w, h)}；${where}被一条 ${STREET_WIDTH} 格的短街切出一块小岛（地块 ${lw}×${lh}，散列抽中，概率 ${ISLAND_CHANCE}）`;
  leaf(c, path, south ? [band, side] : [side, band], [...why, `${nwhy}，其余成为缺角街区`], 'notch');
  leaf(c, path + 'I', [island], [...why, `${nwhy}，这块小岛放不下楼，做成小广场`], 'island');
  return true;
}

const sizeWhy = (c: Ctx, w: number, h: number) =>
  `占地 ${w}×${h}（地块 ${w - 2 * c.sw}×${h - 2 * c.sw}）在${ZONE_NAME[c.zone]}目标内`;
const cutWhy = (c: Ctx, path: string, axis: Axis, at: number, reason: string) =>
  `主干道格 (${c.i},${c.j}) 第 ${path.length + 1} 刀：${axis === 'v' ? '竖切于 x' : '横切于 y'}=${at}（${reason}）`;

/** Splits a rectangle with a straight or jogged street, or keeps it as a block. */
function split(c: Ctx, r: Rect, path: string, why: string[]): void {
  const { seed, i, j, fw, fh } = c;
  const w = r.x1 - r.x0, h = r.y1 - r.y0;
  const inRange = inR(w, fw) && inR(h, fh);
  const pos: Record<Axis, number[]> = {
    v: cutPositions(w, fw, rest => feasible(rest, fw)),
    h: cutPositions(h, fh, rest => feasible(rest, fh)),
  };
  if (inRange && ((!pos.v.length && !pos.h.length) || hash01(seed, 'cut', i, j, path, 'leaf') < LEAF_CHANCE)) {
    if (!notch(c, r, path, why)) leaf(c, path, [r], [...why, `${sizeWhy(c, w, h)}，成为街区`]);
    return;
  }
  if (!pos.v.length && !pos.h.length) throw new Error(`world/blocks: cell ${i},${j} piece ${path || '(root)'} ${w}x${h} cannot be split`);

  // Direction weighted by (side / target side)^2, position uniform among the legal offsets.
  const tw = (fw[0] + fw[1]) / 2, th = (fh[0] + fh[1]) / 2;
  const dirs: [Axis, number][] = [];
  if (pos.v.length) dirs.push(['v', (w / tw) ** 2]);
  if (pos.h.length) dirs.push(['h', (h / th) ** 2]);
  const axis = hashPick(seed, dirs, 'cut', i, j, path, 'dir');
  const [u0, u1, v0, v1] = axis === 'v' ? [r.x0, r.x1, r.y0, r.y1] : [r.y0, r.y1, r.x0, r.x1];
  const len = u1 - u0, along = v1 - v0, ur = axis === 'v' ? fw : fh, vr = axis === 'v' ? fh : fw;
  const reason = inRange ? '宽高都在目标内，散列决定继续切'
    : axis === 'v' ? `宽 ${w} 不在占地目标 ${fw[0]}–${fw[1]} 内` : `高 ${h} 不在占地目标 ${fh[0]}–${fh[1]} 内`;

  // Jog: the street band shifts by d part-way along (the two band halves overlap by STREET - |d|), so each side
  // becomes L-shaped. The side the band moves away from steps first, at vt, and the other side JOG_GAP cells later, so
  // the street widens to STREET + |d| for JOG_GAP cells (room for a car to change over) instead of being cut clean. An L-shaped piece is only ever cut parallel to the jogged street, so its extent along the cut
  // must already be in range, and each side must still end in an L-shaped leaf whose narrow and wide parts fit.
  // A jogged cut is placed uniformly among such offsets; with none, the cut stays straight.
  if (hash01(seed, 'cut', i, j, path, 'jog') < JOG_CHANCE && inR(along, vr)) {
    const step = hashInt(seed, JOG_STEP[0], JOG_STEP[1], 'cut', i, j, path, 'jogd');
    const d = hashInt(seed, 0, 1, 'cut', i, j, path, 'jogs') ? step : -step;
    const jp = pos[axis].filter(a => feasibleL(Math.min(a, a + d), step, ur)
      && feasibleL(Math.min(len - a - STREET_WIDTH, len - a - STREET_WIDTH - d), step, ur));
    if (jp.length) {
      const at = u0 + jp[hashInt(seed, 0, jp.length - 1, 'cut', i, j, path, 'jogpos')];
      const vt = v0 + hashInt(seed, Math.ceil(JOG_AT[0] * along), Math.floor(JOG_AT[1] * along) - JOG_GAP, 'cut', i, j, path, 'jogt');
      const jw = `${cutWhy(c, path, axis, at, reason)}，在${axis === 'v' ? ' y' : ' x'}=${vt}–${vt + JOG_GAP} 处错开 ${step} 格（中间路面加宽，留出一条车道的距离）`;
      // d > 0: the band moves to higher u, so the high side (R) gives way and steps first; d < 0: the low side (L)
      const [vl, vr] = d > 0 ? [vt + JOG_GAP, vt] : [vt, vt + JOG_GAP];
      splitL(c, { axis, lo: false, s: u0, e: [at, at + d], v0, v1, vt: vl }, path + 'L', [...why, jw]);
      splitL(c, { axis, lo: true, s: u1, e: [at + STREET_WIDTH, at + d + STREET_WIDTH], v0, v1, vt: vr }, path + 'R', [...why, jw]);
      return;
    }
  }
  const ps = pos[axis];
  const at = u0 + ps[hashInt(seed, 0, ps.length - 1, 'cut', i, j, path, 'pos')];
  const cw = cutWhy(c, path, axis, at, reason);
  split(c, mk(axis, u0, at, v0, v1), path + 'L', [...why, cw]);
  split(c, mk(axis, at + STREET_WIDTH, u1, v0, v1), path + 'R', [...why, cw]);
}

/** Splits an L-shaped piece by a straight street parallel to its jog (the rect goes to the straight side), or keeps
 *  it as a jog block. */
function splitL(c: Ctx, p: LPiece, path: string, why: string[]): void {
  const { seed, i, j } = c;
  const ur = p.axis === 'v' ? c.fw : c.fh;
  const sgn = p.lo ? -1 : 1;                                   // direction from the straight edge into the piece
  const nw = Math.min(sgn * (p.e[0] - p.s), sgn * (p.e[1] - p.s)), dd = Math.abs(p.e[1] - p.e[0]);
  const pos = cutPositions(nw, ur, rest => feasibleL(rest, dd, ur));
  const fits = inR(nw, ur) && inR(nw + dd, ur);
  if (fits && (!pos.length || hash01(seed, 'cut', i, j, path, 'leaf') < LEAF_CHANCE)) {
    const span = (e: number): [number, number] => (p.lo ? [e, p.s] : [p.s, e]);
    const [a0, a1] = span(p.e[0]), [b0, b1] = span(p.e[1]);
    const foot = [mk(p.axis, a0, a1, p.v0, p.vt), mk(p.axis, b0, b1, p.vt, p.v1)];
    const along = p.v1 - p.v0, [w, h] = p.axis === 'v' ? [nw + dd, along] : [along, nw + dd];
    leaf(c, path, foot, [...why, `${sizeWhy(c, w, h)}（外包框），错开的一侧成为 jog 街区`]);
    return;
  }
  if (!pos.length) throw new Error(`world/blocks: cell ${i},${j} jog piece ${path} (narrow ${nw}, step ${dd}) cannot be split`);
  const a = pos[hashInt(seed, 0, pos.length - 1, 'cut', i, j, path, 'pos')];
  const at = p.lo ? p.s - a : p.s + a;                         // the rect is [s, s + a) or [s - a, s)
  const street = p.lo ? at - STREET_WIDTH : at;                // low edge of the new street band
  const cw = cutWhy(c, path, p.axis, street, `错开的一侧宽 ${nw}–${nw + dd} 还能再切`);
  const rest: LPiece = { ...p, s: p.lo ? street : at + STREET_WIDTH };
  if (p.lo) {
    splitL(c, rest, path + 'L', [...why, cw]);
    split(c, mk(p.axis, at, p.s, p.v0, p.v1), path + 'R', [...why, cw]);
  } else {
    split(c, mk(p.axis, p.s, at, p.v0, p.v1), path + 'L', [...why, cw]);
    splitL(c, rest, path + 'R', [...why, cw]);
  }
}

export type Corner = 'NW' | 'NE' | 'SW' | 'SE';
const CORNERS: readonly Corner[] = ['NW', 'NE', 'SW', 'SE'];
const CORNER_NAME: Record<Corner, string> = { NW: '西北', NE: '东北', SW: '西南', SE: '东南' };
// the junction at each corner of arterial cell (i, j), in CORNERS order
const CORNER_JUNCTIONS: readonly (readonly [number, number])[] = [[0, 0], [1, 0], [0, 1], [1, 1]];

/** Cuts the road cells of a roundabout (by the asset's classes) out of the blocks under them: row runs of
 *  R ∩ cell go into the owning block's `cut` (spec 2.3, 2.5); the walk cells stay that block's sidewalk. */
function cutCorner(c: Ctx, cell: Rect, rb: Roundabout, corner: Corner): void {
  const q: Rect = { x0: Math.max(cell.x0, rb.R.x0), x1: Math.min(cell.x1, rb.R.x1), y0: Math.max(cell.y0, rb.R.y0), y1: Math.min(cell.y1, rb.R.y1) };
  const owner = (x: number, y: number) => c.out.find(b => b.foot.some(f => inRect(f, x, y)));
  const touched = new Set<BlockRec>();
  for (let y = q.y0; y < q.y1; y++) {
    let run: { b: BlockRec; x0: number } | null = null;
    const close = (x: number) => {
      if (!run) return;
      (run.b.cut ??= []).push({ x0: run.x0, x1: x, y0: y, y1: y + 1 });
      touched.add(run.b);
      run = null;
    };
    for (let x = q.x0; x < q.x1; x++) {
      const b = rbClass(rb, x, y) === 'road' ? owner(x, y) : undefined;
      if (run && run.b !== b) close(x);
      if (b && !run) run = { b, x0: x };
    }
    close(q.x1);
  }
  // every footprint cell inside R is the roundabout's sidewalk (spec 2.3), never lot
  for (const b of c.out) for (const f of b.foot) {
    const p: Rect = { x0: Math.max(q.x0, f.x0), x1: Math.min(q.x1, f.x1), y0: Math.max(q.y0, f.y0), y1: Math.min(q.y1, f.y1) };
    if (p.x0 < p.x1 && p.y0 < p.y1) (b.paved ??= []).push(p);
  }
  for (const b of touched) b.why.push(`${CORNER_NAME[corner]}角被环岛 r${rb.i},${rb.j} 切成圆角`);
}

/** A special district's footprint reserved in a corner of a cell by two streets. */
export interface Reservation {
  corner: Corner; axis: Axis;                 // axis of the first cut (v: a band of the footprint's width)
  path: string;                               // two letters; the district id is `b<i>,<j>/${path}D`
  foot: Rect;                                 // the district footprint (campus lot + 2 sw each way)
  bandRest: { r: Rect; path: string };        // the band beside it
  rest: { r: Rect; path: string };            // the rest of the cell
}

/** first of the 8 (corner, axis) ways, starting at `start` (0..7, k -> corner k >> 1 in NW NE SW SE, axis k & 1 ? 'h' : 'v'),
 *  whose band rest and rest are feasible in both directions for fw / fh and whose footprint misses every rect of
 *  `avoid` (the roundabouts' R at the cell's corners); `size(path)` = footprint w, h for that id */
export function reserveCorner(cell: Rect, fw: Range, fh: Range, size: (path: string) => { w: number; h: number }, start: number,
  avoid: readonly Rect[] = []): Reservation | null {
  const S = STREET_WIDTH;
  const fits = (r: Rect) => feasible(r.x1 - r.x0, fw) && feasible(r.y1 - r.y0, fh);
  for (let n = 0; n < 8; n++) {
    const k = (start + n) % 8, corner = CORNERS[k >> 1], axis: Axis = k & 1 ? 'h' : 'v';
    const west = corner.endsWith('W'), north = corner.startsWith('N');
    // u: across the first cut, v: along it; the band is on the low-u side for a west (v) / north (h) corner
    const [lowU, lowV] = axis === 'v' ? [west, north] : [north, west];
    const bandPath = lowU ? 'L' : 'R';
    const path = bandPath + (lowV ? 'L' : 'R');
    const { w, h } = size(path);
    const [du, dv] = axis === 'v' ? [w, h] : [h, w];
    const [u0, u1, v0, v1] = axis === 'v' ? [cell.x0, cell.x1, cell.y0, cell.y1] : [cell.y0, cell.y1, cell.x0, cell.x1];
    const [b0, b1] = lowU ? [u0, u0 + du] : [u1 - du, u1];               // the band
    const [r0, r1] = lowU ? [u0 + du + S, u1] : [u0, u1 - du - S];       // the rest of the cell
    const [f0, f1] = lowV ? [v0, v0 + dv] : [v1 - dv, v1];               // the footprint, along the band
    const [q0, q1] = lowV ? [v0 + dv + S, v1] : [v0, v1 - dv - S];       // the band's rest
    if (du <= 0 || dv <= 0 || r1 <= r0 || q1 <= q0) continue;
    const bandRest = mk(axis, b0, b1, q0, q1), rest = mk(axis, r0, r1, v0, v1);
    const foot = mk(axis, b0, b1, f0, f1);
    if (!fits(bandRest) || !fits(rest) || avoid.some(q => hits(foot, q))) continue;
    return { corner, axis, path, foot,
      bandRest: { r: bandRest, path: bandPath + (lowV ? 'R' : 'L') }, rest: { r: rest, path: lowU ? 'R' : 'L' } };
  }
  return null;
}

/** The special district drawn for arterial cell (i, j) in `zone`, or null (per DISTRICT_CHANCE[zone]). */
export function cellDistrict(seed: string, i: number, j: number, zone: ZoneKind): DistrictKind | null {
  if (hash01(seed, 'district', i, j) >= DISTRICT_CHANCE[zone]) return null;
  const ws = (Object.entries(DISTRICT_WEIGHTS[zone]) as [DistrictKind, number][]).filter(([, w]) => w > 0);
  return ws.length ? hashPick(seed, ws, 'district', i, j, 'kind') : null;
}

/** Reserves a corner of cell r for district `kind` and splits what is left; false when no way of the 8 fits. */
function placeDistrict(c: Ctx, r: Rect, kind: DistrictKind, root: string[]): boolean {
  const { seed, i, j, sw } = c;
  const res = reserveCorner(r, c.fw, c.fh, path => {
    const k = campusFor(`${seed}/b${i},${j}/${path}D`, kind);
    return { w: k.W + 2 * sw, h: k.H + 2 * sw };
  }, hashInt(seed, 0, 7, 'district', i, j, 'way'), c.rbs);
  if (!res) return false;
  const { foot, bandRest, rest, axis } = res;
  const name = DISTRICTS[kind].name, where = CORNER_NAME[res.corner], reason = `为特色街区${name}预留${where}角`;
  const axis2: Axis = axis === 'v' ? 'h' : 'v';
  // each street starts where the lower of its two pieces ends
  const end = (a: Axis, p: Rect) => (a === 'v' ? p.x1 : p.y1);
  const cw1 = cutWhy(c, '', axis, Math.min(end(axis, foot), end(axis, rest.r)), reason);
  const cw2 = cutWhy(c, res.path[0], axis2, Math.min(end(axis2, foot), end(axis2, bandRest.r)), reason);
  const fw = foot.x1 - foot.x0, fh = foot.y1 - foot.y0;
  const cuts = axis === 'v' ? `先竖切出宽 ${fw} 的带，再横切出高 ${fh} 的一块` : `先横切出高 ${fh} 的带，再竖切出宽 ${fw} 的一块`;
  leaf(c, res.path + 'D', [foot], [...root, cw1, cw2,
    `特色街区：${name}（散列抽中，概率 ${DISTRICT_CHANCE[c.zone]}），园区地块 ${fw - 2 * sw}×${fh - 2 * sw}，预留在格的${where}角（${cuts}）`],
  'rect', { district: kind });
  split(c, bandRest.r, bandRest.path, [...root, cw1, cw2]);
  split(c, rest.r, rest.path, [...root, cw1]);
  return true;
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as object)) deepFreeze(v);
  }
  return o;
}

const cache = new Map<string, readonly BlockRec[]>();

/** Clears the per-cell block cache (tests use it to check results do not depend on the cache). */
export function _clearBlockCache(): void { cache.clear(); }

/** Prosperity t in [0, 1] from the zone value p: 0 at P_LO and below, 1 at P_HI and above. */
export function prosperityT(p: number): number {
  return Math.min(1, Math.max(0, (p - P_LO) / (P_HI - P_LO)));
}

/** Target lot ranges (inside the sidewalk ring) at zone value p: LOT_RANGE.lo at t = 0 to LOT_RANGE.hi at t = 1. */
export function lotRange(p: number): { w: Range; h: Range } {
  const t = prosperityT(p);
  const lerp = (a: Range, b: Range): Range => [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t)];
  return { w: lerp(LOT_RANGE.lo.w, LOT_RANGE.hi.w), h: lerp(LOT_RANGE.lo.h, LOT_RANGE.hi.h) };
}

/** r with its upper bound raised by 1 until a length can be filled (feasible). */
export function widenToFit(len: number, r: Range): Range {
  let hi = r[1];
  while (!feasible(len, [r[0], hi])) {
    hi++;
    if (hi > len) throw new Error(`world/blocks: length ${len} cannot be filled with pieces from ${r[0]}`);
  }
  return [r[0], hi];
}

/** The lot ranges of arterial cell (i, j): interpolated from the prosperity at the cell centre, then widened where the
 *  cell's footprint extent cannot be filled by pieces in range. lotW / lotH are the widened ranges. */
export function cellLotRange(seed: string, i: number, j: number):
  { p: number; t: number; zone: ZoneKind; lotW: Range; lotH: Range; widened: boolean; note: string } {
  const r = cellRect(seed, i, j);
  const cx = Math.floor((r.x0 + r.x1) / 2), cy = Math.floor((r.y0 + r.y1) / 2);
  const p = zoneValue(seed, cx, cy), zone = zoneAt(seed, cx, cy), sw = ZONES[zone].sw;
  const base = lotRange(p);
  const fw = widenToFit(r.x1 - r.x0, [base.w[0] + 2 * sw, base.w[1] + 2 * sw]);
  const fh = widenToFit(r.y1 - r.y0, [base.h[0] + 2 * sw, base.h[1] + 2 * sw]);
  const lotW: Range = [fw[0] - 2 * sw, fw[1] - 2 * sw], lotH: Range = [fh[0] - 2 * sw, fh[1] - 2 * sw];
  const notes: string[] = [];
  if (lotW[1] !== base.w[1]) notes.push(`宽 ${r.x1 - r.x0}，上限放宽到 ${lotW[1]}`);
  if (lotH[1] !== base.h[1]) notes.push(`高 ${r.y1 - r.y0}，上限放宽到 ${lotH[1]}`);
  return { p, t: prosperityT(p), zone, lotW, lotH, widened: notes.length > 0,
    note: notes.length ? `（按原插值切不开格的${notes.join('；')}）` : '' };
}

/** The blocks of arterial cell (i, j), frozen and cached. */
export function cellBlocks(seed: string, i: number, j: number): readonly BlockRec[] {
  const key = `${seed}|${i},${j}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const r = cellRect(seed, i, j);
  const cx = Math.floor((r.x0 + r.x1) / 2), cy = Math.floor((r.y0 + r.y1) / 2);
  const { p, zone, lotW, lotH, note } = cellLotRange(seed, i, j);
  const { sw } = ZONES[zone];
  // roundabouts at the cell's four corners (junctions i / i + 1 x j / j + 1)
  const rbs = CORNER_JUNCTIONS.map(([di, dj]) => roundabout(seed, i + di, j + dj));
  const c: Ctx = {
    seed, i, j, zone, sw, out: [], rbs: rbs.filter(q => q !== null).map(q => q.R),
    fw: [lotW[0] + 2 * sw, lotW[1] + 2 * sw], fh: [lotH[0] + 2 * sw, lotH[1] + 2 * sw],
  };
  const root = [
    `繁荣度 ${p.toFixed(2)}（${ZONE_NAME[zone]}），地块目标 ${lotW[0]}–${lotW[1]} × ${lotH[0]}–${lotH[1]}${note}`,
    `主干道格 (${i},${j}) 中心 (${cx},${cy}) 的分区是${ZONE_NAME[zone]}，人行道宽 ${sw} 格`,
  ];
  // a special district first takes a corner of the cell (spec 2.2); the rest splits as usual
  const kind = cellDistrict(seed, i, j, zone);
  if (!kind || !placeDistrict(c, r, kind, root)) {
    if (kind) root.push(`抽到特色街区${DISTRICTS[kind].name}，但园区在 8 种预留方式下都切不开剩下的部分，不放`);
    split(c, r, '', root);
  }
  rbs.forEach((rb, k) => { if (rb) cutCorner(c, r, rb, CORNERS[k]); });
  const out = deepFreeze(c.out) as readonly BlockRec[];
  if (cache.size >= CELL_CACHE) cache.delete(cache.keys().next().value!);
  cache.set(key, out);
  return out;
}

function inRect(r: Rect, x: number, y: number): boolean { return x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1; }
/** In one of the footprint rects and not cut out of it. */
const inFoot = (b: BlockRec, x: number, y: number) => b.foot.some(r => inRect(r, x, y)) && !b.cut?.some(r => inRect(r, x, y));

/** The block whose footprint contains (x, y) (a roundabout's centre island included), or null when the cell is road. */
export function blockAt(seed: string, x: number, y: number): BlockRec | null {
  const ij = cellAt(seed, x, y);
  if (!ij) {
    const rb = roundaboutAt(seed, x, y);
    return rb && inRect(rb.island, x, y) ? islandBlock(seed, rb) : null;
  }
  return cellBlocks(seed, ij[0], ij[1]).find(b => inFoot(b, x, y)) ?? null;
}

/** The block with this id (`b<i>,<j>/<path>`, or `r<i>,<j>` for a roundabout's island); throws when there is none. */
export function blockById(seed: string, id: string): BlockRec {
  const m = /^b(-?\d+),(-?\d+)\//.exec(id), r = /^r(-?\d+),(-?\d+)$/.exec(id);
  const rb = r ? roundabout(seed, Number(r[1]), Number(r[2])) : null;
  const b = m ? cellBlocks(seed, Number(m[1]), Number(m[2])).find(o => o.id === id) : rb ? islandBlock(seed, rb) : undefined;
  if (!b) throw new Error(`world/blocks: no block ${id} for seed ${seed}`);
  return b;
}

/** Lot cells are footprint cells whose Chebyshev distance to the outside of the footprint is > sw and that are not
 *  `paved` (inside a roundabout); the rest is sidewalk. */
export function lotOf(b: BlockRec, x: number, y: number): boolean {
  if (b.paved?.some(r => inRect(r, x, y))) return false;
  for (let dy = -b.sw; dy <= b.sw; dy++) for (let dx = -b.sw; dx <= b.sw; dx++) {
    if (!inFoot(b, x + dx, y + dy)) return false;
  }
  return true;
}
