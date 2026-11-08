// Block geometry, road network and ground tiles.
//
// Main block interior P (randomised size around 28x20 cells, randomised shape) -> sidewalk ring Q = P grown by
// `sw` -> road band = Q grown by (rV horizontally, rH vertically) minus Q. Everything else belongs to
// neighbouring blocks (each connected component is one neighbour) with their own sidewalk ring.
// Because roads are a dilation of the block outline, notches/jogs in the block automatically give jogging
// roads and matching neighbour outlines.

import { Rng } from './rng';
import { AUTOTILE } from './assets';
import type { CellClass, TileRef } from './types';

export interface Seg { axis: 'h' | 'v'; band0: number; band1: number; a: number; b: number }   // road corridor segment
export interface Crossing { axis: 'h' | 'v'; band0: number; band1: number; at: number }        // zebra: 2 cells starting at `at`

export interface Layout {
  cols: number; rows: number;
  cls: CellClass[][];
  /** main block interior mask (cls 'lot' cells of the main block) */
  inP: boolean[][];
  /** bounding box of the main interior (inclusive-exclusive) */
  bx0: number; by0: number; bx1: number; by1: number;
  rH: number; rV: number; sw: number; sw2: number;
  /** Chebyshev distance (cells) to the nearest road cell */
  roadDist: number[][];
  shape: string;
  /** neighbour region id per cell (-1 main / road) */
  region: number[][];
  regionStyle: string[];
  mainStyle: string;
  segs: Seg[];
  crossings: Crossing[];
  base: (TileRef | null)[][];
  over: (TileRef | null)[][];
  /** semantic marks on road cells: 'dash', 'zebra', 'park', 'bus' ... */
  mark: string[][];
}

const grid = <T>(r: number, c: number, v: T): T[][] => Array.from({ length: r }, () => Array<T>(c).fill(v));

function dilate(m: boolean[][], rx: number, ry: number): boolean[][] {
  const R = m.length, C = m[0].length;
  const tmp = grid(R, C, false), out = grid(R, C, false);
  for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) if (m[y][x])
    for (let dx = -rx; dx <= rx; dx++) { const xx = x + dx; if (xx >= 0 && xx < C) tmp[y][xx] = true; }
  for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) if (tmp[y][x])
    for (let dy = -ry; dy <= ry; dy++) { const yy = y + dy; if (yy >= 0 && yy < R) out[yy][x] = true; }
  return out;
}

function chebDist(m: boolean[][]): number[][] {
  const R = m.length, C = m[0].length, INF = 1e6;
  const d: number[][] = m.map(row => row.map(v => (v ? 0 : INF)));
  for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) for (const [dx, dy] of [[-1, 0], [0, -1], [-1, -1], [1, -1]]) {
    const v = d[y + dy]?.[x + dx]; if (v !== undefined && v + 1 < d[y][x]) d[y][x] = v + 1; }
  for (let y = R - 1; y >= 0; y--) for (let x = C - 1; x >= 0; x--) for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [-1, 1]]) {
    const v = d[y + dy]?.[x + dx]; if (v !== undefined && v + 1 < d[y][x]) d[y][x] = v + 1; }
  return d;
}

const SIDEWALK_STYLES = ['sidewalk_lightbeige', 'sidewalk_beige', 'sidewalk_lightgrey', 'sidewalk_grey', 'sidewalk_brown', 'sidewalk_blue'];

/** `need` (exp-08 special districts): the main interior is exactly need.w x need.h cells, a plain rectangle (the block
 *  is the landmark's campus, district.ts) */
export function makeLayout(rng: Rng, need?: { w: number; h: number }): Layout {
  const r = rng.fork('layout');
  // ---- size & shape of the main interior ----
  const area = Math.round(560 * r.range(0.72, 1.3));
  const aspect = r.range(1.05, 1.9);
  let W = Math.max(18, Math.min(40, Math.round(Math.sqrt(area * aspect))));
  let H = Math.max(13, Math.min(28, Math.round(area / W)));
  if (need) { W = need.w; H = need.h; }
  // ---- widths (decided first: notch sizes depend on them) ----
  const rH = r.choose('layout.roadH', {}, { weights: [[5, 5], [7, 2]] as const });         // horizontal roads (north/south)
  const rV = r.choose('layout.roadV', {}, { weights: [[5, 4], [7, 2], [9, 1]] as const }); // vertical roads (east/west)
  const sw = r.choose('layout.sidewalk', {}, { weights: [[2, 3], [3, 2]] as const });
  const sw2 = r.choose('layout.sidewalkNeigh', {}, { weights: [[2, 3], [3, 1]] as const });
  // ---- shape ----
  //  rect  : plain rectangle
  //  jog   : one side steps inward by 2-4 cells -> the street there is offset (pure dilation follows it)
  //  notch : a corner is cut out and holds a small island block reached by a short street (T-junctions)
  let shape: string = r.choose('layout.shape', { area, W, H }, { weights: [['rect', 3], ['notch', 4], ['jog', 3], ['notchjog', 1]] as const });
  if (need) shape = 'rect';
  const P = grid(H, W, true);
  const carve = (x0: number, y0: number, w: number, h: number) => {
    for (let y = Math.max(0, y0); y < Math.min(H, y0 + h); y++) for (let x = Math.max(0, x0); x < Math.min(W, x0 + w); x++) P[y][x] = false;
  };
  let notchCorner = -1;
  if (shape.startsWith('notch')) {
    const minW = sw + rV + 2 * sw2 + 2, minH = sw + rH + 2 * sw2 + 2;
    const maxW = Math.floor(W * 0.6), maxH = Math.floor(H * 0.7);
    if (minW > maxW || minH > maxH) shape = shape === 'notchjog' ? 'jog' : 'rect';
    else { notchCorner = r.choose('layout.notchCorner', {}, [0, 1, 2, 3]); const nw = r.int(minW, maxW), nh = r.int(minH, maxH);
      carve(notchCorner & 1 ? W - nw : 0, notchCorner & 2 ? H - nh : 0, nw, nh); }
  }
  if (shape === 'jog' || shape === 'notchjog') {
    // one side steps inward by k cells over a part of its length (not the notched corner's sides)
    const k = r.int(2, 4);
    let side = r.choose('layout.jogSide', {}, [0, 1, 2, 3]);
    if (notchCorner >= 0) side = (notchCorner & 2) ? 0 : 1;       // N(0) or S(1) side opposite to the notch
    if (side < 2) { const t = r.int(Math.floor(W * 0.3), Math.floor(W * 0.7)); const left = notchCorner >= 0 ? !(notchCorner & 1) : r.choose('layout.jogLeft', {}, { p: 0.5 });
      carve(left ? 0 : t, side === 0 ? 0 : H - k, left ? t : W - t, k); }
    else { const t = r.int(Math.floor(H * 0.3), Math.floor(H * 0.7)); const top = r.choose('layout.jogTop', {}, { p: 0.5 });
      carve(side === 2 ? 0 : W - k, top ? 0 : t, k, top ? t : H - t); }
  }
  // ---- margins & placement ----
  const mN = r.int(4, 9), mS = r.int(3, 7), mW = r.int(3, 8), mE = r.int(3, 8);
  const cols = mW + rV + sw + W + sw + rV + mE;
  const rows = mN + rH + sw + H + sw + rH + mS;
  const ox = mW + rV + sw, oy = mN + rH + sw;
  const inP = grid(rows, cols, false);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) inP[oy + y][ox + x] = P[y][x];
  const Q = dilate(inP, sw, sw);
  const QR = dilate(Q, rV, rH);
  const cls = grid<CellClass>(rows, cols, 'nlot');
  const road = grid(rows, cols, false);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (inP[y][x]) cls[y][x] = 'lot';
    else if (Q[y][x]) cls[y][x] = 'walk';
    else if (QR[y][x]) { cls[y][x] = 'road'; road[y][x] = true; }
  }
  const setRoad = (x: number, y: number) => { if (!Q[y][x]) { road[y][x] = true; cls[y][x] = 'road'; } };
  const qx0 = ox - sw, qx1 = ox + W + sw, qy0 = oy - sw, qy1 = oy + H + sw;   // Q bounding box
  if (notchCorner >= 0) {
    // straight streets along the bounding box; the notch keeps its own ring road -> island + T-junctions
    for (let x = 0; x < cols; x++) for (let y = qy0 - rH; y < qy0; y++) setRoad(x, y);
    for (let x = 0; x < cols; x++) for (let y = qy1; y < qy1 + rH; y++) setRoad(x, y);
    for (let y = 0; y < rows; y++) for (let x = qx0 - rV; x < qx0; x++) setRoad(x, y);
    for (let y = 0; y < rows; y++) for (let x = qx1; x < qx1 + rV; x++) setRoad(x, y);
  } else {
    // streets continue past the block corners to the picture edge; the arm follows the road band found next
    // to Q's extreme column/row, so jogs carry through as offset streets.
    const colBand = (x: number, above: boolean): number[] => {
      const ys: number[] = [];
      if (above) { let y = 0; while (y < rows && !Q[y][x]) y++; for (let k = y - 1; k >= 0 && road[k][x]; k--) ys.push(k); }
      else { let y = rows - 1; while (y >= 0 && !Q[y][x]) y--; for (let k = y + 1; k < rows && road[k][x]; k++) ys.push(k); }
      return ys;
    };
    const rowBand = (y: number, left: boolean): number[] => {
      const xs: number[] = [];
      if (left) { let x = 0; while (x < cols && !Q[y][x]) x++; for (let k = x - 1; k >= 0 && road[y][k]; k--) xs.push(k); }
      else { let x = cols - 1; while (x >= 0 && !Q[y][x]) x--; for (let k = x + 1; k < cols && road[y][k]; k++) xs.push(k); }
      return xs;
    };
    const firstQ = (axis: 'x' | 'y', from: 'lo' | 'hi'): number => {
      if (axis === 'x') { for (let i = 0; i < cols; i++) { const x = from === 'lo' ? i : cols - 1 - i; for (let y = 0; y < rows; y++) if (Q[y][x]) return x; } }
      else { for (let i = 0; i < rows; i++) { const y = from === 'lo' ? i : rows - 1 - i; for (let x = 0; x < cols; x++) if (Q[y][x]) return y; } }
      return 0;
    };
    const xL = firstQ('x', 'lo'), xR = firstQ('x', 'hi'), yT = firstQ('y', 'lo'), yB = firstQ('y', 'hi');
    const hArms = ([[xL, -1], [xR, 1]] as const).flatMap(([x, dir]) => [true, false].map(above => ({ x, dir, band: colBand(x, above) })));
    const vArms = ([[yT, -1], [yB, 1]] as const).flatMap(([y, dir]) => [true, false].map(left => ({ y, dir, band: rowBand(y, left) })));
    for (const { x, dir, band } of hArms) for (let xx = x; xx >= 0 && xx < cols; xx += dir) for (const y of band) setRoad(xx, y);
    for (const { y, dir, band } of vArms) for (let yy = y; yy >= 0 && yy < rows; yy += dir) for (const x of band) setRoad(x, yy);
  }

  const NW = dilate(road, sw2, sw2);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (cls[y][x] === 'nlot' && NW[y][x]) cls[y][x] = 'nwalk';
  // ---- neighbour regions (connected components of non-road outside Q) ----
  const region = grid(rows, cols, -1);
  let nreg = 0;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (region[y][x] !== -1 || !(cls[y][x] === 'nlot' || cls[y][x] === 'nwalk')) continue;
    const st = [[x, y]]; region[y][x] = nreg;
    while (st.length) { const [cx, cy] = st.pop()!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || region[ny][nx] !== -1) continue;
        if (cls[ny][nx] === 'nlot' || cls[ny][nx] === 'nwalk') { region[ny][nx] = nreg; st.push([nx, ny]); } } }
    nreg++;
  }
  const mainStyle = r.choose('layout.mainPaving', {}, SIDEWALK_STYLES);
  const regionStyle = Array.from({ length: nreg }, (_, i) => r.choose('layout.neighPaving', { region: i }, SIDEWALK_STYLES));
  const L: Layout = { cols, rows, cls, inP, bx0: ox, by0: oy, bx1: ox + W, by1: oy + H, rH, rV, sw, sw2, roadDist: chebDist(road), shape, region, regionStyle,
    mainStyle, segs: [], crossings: [], base: grid<TileRef | null>(rows, cols, null), over: grid<TileRef | null>(rows, cols, null),
    mark: grid(rows, cols, '') };
  paintGround(L, r.fork('ground'));
  return L;
}

// ------------------------------------------------------------------------------------------------
// ground tiles

const BITS = { N: 1, NE: 2, E: 4, SE: 8, S: 16, SW: 32, W: 64, NW: 128 };
function canon(m: number): number {
  const pairs: [number, number, number][] = [[BITS.NE, BITS.N, BITS.E], [BITS.SE, BITS.S, BITS.E], [BITS.SW, BITS.S, BITS.W], [BITS.NW, BITS.N, BITS.W]];
  for (const [c, a, b] of pairs) if (!((m & a) && (m & b))) m &= ~c;
  return m;
}
export function autotile(style: string, mask: number): TileRef {
  const t = AUTOTILE[style].masks[String(canon(mask))] ?? AUTOTILE[style].masks['255'];
  return ['auto', t[0], t[1]];
}

/** 2_City_Terrains colour block (col,row offset) whose 4x4 slab patch (cols 9-12, rows 0-3) matches each autotile style */
const SLAB_BLOCK: Record<string, [number, number]> = {
  sidewalk_lightbeige: [0, 0], sidewalk_beige: [0, 23], sidewalk_lightgrey: [30, 0],
  sidewalk_grey: [0, 46], sidewalk_brown: [30, 46], sidewalk_blue: [30, 23],
};
export function slab(style: string, x: number, y: number): TileRef {
  const [bx, by] = SLAB_BLOCK[style];
  return ['city', bx + 9 + (x % 4), by + (y % 2)];   // rows 0-1: seamless slabs (row 3 is an edge piece)
}

const ASPHALT: [TileRef, number][] = [
  [['city', 1, 4], 30], [['city', 2, 4], 10], [['city', 0, 5], 10], [['city', 1, 5], 10], [['city', 3, 5], 6],
  [['city', 2, 6], 6], [['city', 4, 6], 3], [['city', 0, 7], 1.5], [['city', 2, 7], 1.5], [['city', 4, 7], 1],
];

/** sidewalk / lot cell: 47-blob autotile, "inside" = not road; picture border continues the cell itself */
export function paintWalkCell(L: Layout, x: number, y: number) {
  const { rows, cols, cls } = L;
  const isRoad = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < cols && yy < rows ? cls[yy][xx] === 'road' : null;
  let m = 0;
  const dirs: [number, number, number][] = [[0, -1, BITS.N], [1, -1, BITS.NE], [1, 0, BITS.E], [1, 1, BITS.SE], [0, 1, BITS.S], [-1, 1, BITS.SW], [-1, 0, BITS.W], [-1, -1, BITS.NW]];
  for (const [dx, dy, b] of dirs) { const rr = isRoad(x + dx, y + dy); if (rr === false || rr === null) m |= b; }
  const style = L.region[y][x] >= 0 ? L.regionStyle[L.region[y][x]] : L.mainStyle;
  L.base[y][x] = canon(m) === 255 ? slab(style, x, y) : autotile(style, m);
}

export function asphalt(r: Rng): TileRef { return r.tex('asphalt', { weights: ASPHALT }); }

function paintGround(L: Layout, r: Rng) {
  for (let y = 0; y < L.rows; y++) for (let x = 0; x < L.cols; x++) {
    if (L.cls[y][x] === 'road') L.base[y][x] = r.tex('asphalt', { weights: ASPHALT });
    else paintWalkCell(L, x, y);
  }
  roadMarkings(L, r);
}

/** corridor analysis: run lengths of road cells; dashes on corridor centre lines; zebra crossings near intersections */
function roadMarkings(L: Layout, r: Rng) {
  const { rows, cols, cls } = L;
  const road = (x: number, y: number) => x >= 0 && y >= 0 && x < cols && y < rows && cls[y][x] === 'road';
  // vertical run (for horizontal corridors) and horizontal run (for vertical corridors)
  const vrun = grid(rows, cols, 0), vidx = grid(rows, cols, 0), hrun = grid(rows, cols, 0), hidx = grid(rows, cols, 0);
  const vbounded = grid(rows, cols, false), hbounded = grid(rows, cols, false);
  for (let x = 0; x < cols; x++) { let y = 0; while (y < rows) { if (!road(x, y)) { y++; continue; }
    let e = y; while (e < rows && road(x, e)) e++;
    for (let k = y; k < e; k++) { vrun[k][x] = e - y; vidx[k][x] = k - y; vbounded[k][x] = y > 0 && e < rows; } y = e; } }
  for (let y = 0; y < rows; y++) { let x = 0; while (x < cols) { if (!road(x, y)) { x++; continue; }
    let e = x; while (e < cols && road(e, y)) e++;
    for (let k = x; k < e; k++) { hrun[y][k] = e - x; hidx[y][k] = k - x; hbounded[y][k] = x > 0 && e < cols; } x = e; } }
  const hcorr = (x: number, y: number) => road(x, y) && vbounded[y][x] && vrun[y][x] === L.rH && !(hbounded[y][x] && hrun[y][x] === L.rV);
  const vcorr = (x: number, y: number) => road(x, y) && hbounded[y][x] && hrun[y][x] === L.rV && !(vbounded[y][x] && vrun[y][x] === L.rH);
  // horizontal corridor segments: group by band (top row of the vertical run) and contiguous x
  const segs: Seg[] = [];
  for (let y = 0; y < rows; y++) { let x = 0; while (x < cols) {
    if (!(hcorr(x, y) && vidx[y][x] === 0)) { x++; continue; }
    let e = x; while (e < cols && hcorr(e, y) && vidx[y][e] === 0) e++;
    segs.push({ axis: 'h', band0: y, band1: y + L.rH, a: x, b: e }); x = e; } }
  for (let x = 0; x < cols; x++) { let y = 0; while (y < rows) {
    if (!(vcorr(x, y) && hidx[y][x] === 0)) { y++; continue; }
    let e = y; while (e < rows && vcorr(x, e) && hidx[e][x] === 0) e++;
    segs.push({ axis: 'v', band0: x, band1: x + L.rV, a: y, b: e }); y = e; } }
  L.segs = segs;
  // zebra crossings: candidates = corridor ends next to an intersection; per intersection keep 0-2 of them,
  // more likely where the main block is involved (refs show 1-3 crossings per junction, never all arms).
  type Cand = { s: Seg; at: number; key: string; main: boolean };
  const cands: Cand[] = [];
  const touchesMain = (sg: Seg, p: number) => {
    for (const off of [-1, sg.band1 - sg.band0]) {
      const [x, y] = sg.axis === 'h' ? [p, sg.band0 + off] : [sg.band0 + off, p];
      if (y >= 0 && x >= 0 && y < rows && x < cols && (cls[y][x] === 'walk' || cls[y][x] === 'lot')) return true;
    }
    return false;
  };
  for (const sg of segs) {
    if (sg.b - sg.a < 8) continue;
    for (const end of ['a', 'b'] as const) {
      const atEdge = end === 'a' ? sg.a === 0 : sg.b >= (sg.axis === 'h' ? cols : rows);
      if (atEdge) continue;
      const gap = r.int(0, 1);
      const at = end === 'a' ? sg.a + gap : sg.b - 2 - gap;
      const ex = end === 'a' ? sg.a - 1 : sg.b;            // first intersection cell beyond the end
      const [ix, iy] = sg.axis === 'h' ? [ex, sg.band0] : [sg.band0, ex];
      cands.push({ s: sg, at, key: `${Math.round(ix / 6)},${Math.round(iy / 6)}`, main: touchesMain(sg, at) });
    }
  }
  const byKey = new Map<string, Cand[]>();
  for (const c of cands) byKey.set(c.key, [...(byKey.get(c.key) ?? []), c]);
  for (const group of byKey.values()) {
    const main = group.some(c => c.main);
    const k = r.choose('crossing.count', { main }, { weights: main ? [[0, 1], [1, 4], [2, 3]] as const : [[0, 5], [1, 4], [2, 1]] as const });
    r.order('crossing.order', { main }, group).sort((p, q) => +q.main - +p.main);
    for (const c of group.slice(0, k)) {
      const sg = c.s;
      L.crossings.push({ axis: sg.axis, band0: sg.band0, band1: sg.band1, at: c.at });
      for (let k2 = sg.band0; k2 < sg.band1; k2++) for (let j = 0; j < 2; j++) {
        const [x, y] = sg.axis === 'h' ? [c.at + j, k2] : [k2, c.at + j];
        // crossing a horizontal road (walking N-S): horizontal bars; vertical road: vertical bars
        const t: TileRef = sg.axis === 'h' ? ['city', 7 + j, 4 + ((k2 - sg.band0) % 2)] : ['city', 7 + ((k2 - sg.band0) % 2), 6 + j];
        L.base[y][x] = t; L.mark[y][x] = 'zebra';
      }
    }
  }
  // centre dashes: middle line of each corridor, stopping 1 cell before zebras / segment ends
  for (const s of segs) {
    if (s.b - s.a < 6) continue;
    const mid = s.band0 + Math.floor((s.band1 - s.band0) / 2);
    for (let p = s.a + 1; p < s.b - 1; p++) {
      const [x, y] = s.axis === 'h' ? [p, mid] : [mid, p];
      const near = (q: number) => { const [xx, yy] = s.axis === 'h' ? [q, mid] : [mid, q]; return L.mark[yy]?.[xx] === 'zebra'; };
      if (near(p) || near(p - 1) || near(p + 1)) continue;
      L.base[y][x] = s.axis === 'h' ? ['city', 12, 6] : ['city', 12, 7];
      L.mark[y][x] = 'dash';
    }
  }
}
