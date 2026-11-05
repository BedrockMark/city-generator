// Stage 6 judge: windows and the interpretable features computed on them (spec 2.1, 2.3).
// A window is 8x8 cells (128 px), stride 4 cells; windows with fewer than 32 cells of known ground off the road are
// skipped: mostly-road windows say how a map is framed (generated maps carry wide road margins), not what stands
// on the block, and the repair cannot change the roads (2026-11-03, the first heat maps were red all over the roads).
// The feature table is data: each entry has an id, a Chinese name and what a high value means. Features the user
// rejects go into blacklist.json and are skipped by training and scoring.
import type { PxRect } from '../types';
import type { JWorld, JObj, JGround } from './align';
import blacklistRaw from './blacklist.json';

export const WIN = 8, STRIDE = 4, MIN_VALID = 32;
const T = 16;

export interface Win { c0: number; r0: number; rect: PxRect }

export function windows(w: JWorld): Win[] {
  const out: Win[] = [];
  for (let r0 = 0; r0 + WIN <= w.rows; r0 += STRIDE) for (let c0 = 0; c0 + WIN <= w.cols; c0 += STRIDE) {
    let valid = 0;
    for (let r = r0; r < r0 + WIN; r++) for (let c = c0; c < c0 + WIN; c++) { const g = w.ground[r][c]; if (g !== 'none' && g !== 'road') valid++; }
    if (valid >= MIN_VALID) out.push({ c0, r0, rect: { x0: w.ox + c0 * T, y0: w.oy + r0 * T, x1: w.ox + (c0 + WIN) * T, y1: w.oy + (r0 + WIN) * T } });
  }
  return out;
}

/** per-map precomputation shared by every window */
export interface FeatCtx {
  w: JWorld;
  /** cell is covered by some object's opaque box */
  covered: boolean[][];
  /** cell centre is >= 32 px from every object's box */
  far: boolean[][];
}

/** per-window values the features read */
export interface WinData {
  win: Win; cx: FeatCtx;
  cells: JGround[];
  n: Record<JGround, number>;
  valid: number; placeable: number;
  objs: JObj[];
  /** objs without the novel ones (stage 7): what the d.* and p.* features count */
  known: JObj[];
}

export interface Feature { id: string; name: string; high: string; f: (d: WinData) => number }

const PLACEABLE = new Set<JGround>(['paved', 'grass', 'other']);
const GROUPS: Record<string, string[]> = {
  curb: ['street_lamp', 'traffic_light', 'hydrant', 'bollard', 'manhole'],
  plant: ['tree', 'plant'],
  trash: ['trash'],
  seat: ['bench', 'table'],
  vehicle: ['vehicle'],
  sign: ['info_sign', 'traffic_sign'],
  other: ['utility', 'fence', 'crate', 'other'],
};
const LIFT: [string, string][] = [['table', 'bench'], ['trash', 'trash'], ['tree', 'bench'], ['traffic_light', 'traffic_light']];

const frac = (n: number, d: number) => d > 0 ? n / d : 0;
const dist = (a: JObj, b: JObj) => Math.hypot(a.fx - b.fx, a.fy - b.fy);
const gap = (a: PxRect, b: PxRect) => Math.hypot(Math.max(0, b.x0 - a.x1, a.x0 - b.x1), Math.max(0, b.y0 - a.y1, a.y0 - b.y1));
const cellOf = (w: JWorld, x: number, y: number) => [Math.floor((x - w.ox) / T), Math.floor((y - w.oy) / T)] as const;
const groundAt = (w: JWorld, c: number, r: number): JGround => w.ground[r]?.[c] ?? 'none';

function density(group: string): (d: WinData) => number {
  const cls = new Set(GROUPS[group]);
  return d => frac(d.known.filter(o => cls.has(o.cls)).length, d.placeable);
}

/** largest all-true rectangle in a row-major WIN x WIN mask (histogram method), in cells */
function largestRect(mask: boolean[][]): number {
  const h = new Array(WIN).fill(0);
  let best = 0;
  for (const row of mask) {
    for (let c = 0; c < WIN; c++) h[c] = row[c] ? h[c] + 1 : 0;
    const st: number[] = [];
    for (let c = 0; c <= WIN; c++) {
      const cur = c < WIN ? h[c] : 0;
      while (st.length && h[st[st.length - 1]] >= cur) {
        const top = st.pop()!, left = st.length ? st[st.length - 1] + 1 : 0;
        best = Math.max(best, h[top] * (c - left));
      }
      st.push(c);
    }
  }
  return best;
}

/** objects that belong to an evenly spaced row: >= 3 in a line (feet within 4 px across), spacing differing <= 4 px */
function rowMembers(objs: JObj[]): Set<JObj> {
  const out = new Set<JObj>();
  for (const axis of ['x', 'y'] as const) {
    const along = (o: JObj) => axis === 'x' ? o.fx : o.fy, across = (o: JObj) => axis === 'x' ? o.fy : o.fx;
    for (const a of objs) {
      const line = objs.filter(o => Math.abs(across(o) - across(a)) <= 4).sort((p, q) => along(p) - along(q));
      for (let i = 0; i + 2 < line.length; i++) {
        const s1 = along(line[i + 1]) - along(line[i]), s2 = along(line[i + 2]) - along(line[i + 1]);
        if (s1 > 4 && Math.abs(s1 - s2) <= 4) { out.add(line[i]); out.add(line[i + 1]); out.add(line[i + 2]); }
      }
    }
  }
  return out;
}

/** distance from a point to the nearest curb (cell edge between road and placeable ground), searched 1 cell around */
function curbDist(w: JWorld, x: number, y: number): number {
  const [c, r] = cellOf(w, x, y);
  let best = Infinity;
  const isCurb = (a: JGround, b: JGround) => (a === 'road' && PLACEABLE.has(b)) || (b === 'road' && PLACEABLE.has(a));
  for (let rr = r - 1; rr <= r + 1; rr++) for (let cc = c - 1; cc <= c + 1; cc++) {
    const x0 = w.ox + cc * T, y0 = w.oy + rr * T;
    // vertical edge on the left of (cc, rr), horizontal edge on its top
    if (isCurb(groundAt(w, cc - 1, rr), groundAt(w, cc, rr))) best = Math.min(best, Math.hypot(x - x0, Math.max(0, y0 - y, y - (y0 + T))));
    if (isCurb(groundAt(w, cc, rr - 1), groundAt(w, cc, rr))) best = Math.min(best, Math.hypot(Math.max(0, x0 - x, x - (x0 + T)), y - y0));
  }
  return best;
}

/** grass / paving boundary inside the window: unit edges, and the share of them in straight runs of >= 4 cells */
function boundary(d: WinData): { edges: number; straight: number; corners: number } {
  const { w } = d.cx, { c0, r0 } = d.win;
  const g = (c: number, r: number) => groundAt(w, c, r);
  const isB = (a: JGround, b: JGround) => (a === 'grass' && b === 'paved') || (a === 'paved' && b === 'grass');
  let edges = 0, straight = 0;
  const runs = (n: number, at: (i: number, j: number) => boolean) => {
    for (let i = 0; i < n; i++) {
      let run = 0;
      for (let j = 0; j <= WIN; j++) {
        if (j < WIN && at(i, j)) { run++; continue; }
        edges += run; if (run >= 4) straight += run; run = 0;
      }
    }
  };
  // horizontal edges between rows r-1 and r (i = r offset 1..7), vertical edges between columns
  runs(WIN - 1, (i, j) => isB(g(c0 + j, r0 + i), g(c0 + j, r0 + i + 1)));
  runs(WIN - 1, (i, j) => isB(g(c0 + i, r0 + j), g(c0 + i + 1, r0 + j)));
  let corners = 0;
  for (let r = r0 + 1; r < r0 + WIN; r++) for (let c = c0 + 1; c < c0 + WIN; c++) {
    const k = [g(c - 1, r - 1), g(c, r - 1), g(c - 1, r), g(c, r)].filter(x => x === 'grass').length;
    if (k === 1 || k === 3) corners++;
    else if (k === 2 && (g(c - 1, r - 1) === 'grass') === (g(c, r) === 'grass')) corners += 2;
  }
  return { edges, straight, corners };
}

// ground shares of paving / lawn / buildings are taken over those three kinds only. 'other' ground (sand, dirt,
// water, coloured tiles) only occurs in the references, and the road share mostly measures how a map is framed
// (generated maps carry wide road margins); both are blacklisted, and shares that sum to 1 - other - road would
// let the model learn them back (2026-11-03: g.other alone got weight -10; then road / wall / paved / grass
// +15 / +14 / +9 / +3; with road out too, grass / wall / paved all went negative). g.road is still computed over
// the four painted kinds.
export const FEATURES: Feature[] = [
  { id: 'g.road', name: '马路占比', high: '马路多', f: d => frac(d.n.road, d.valid - d.n.other) },
  { id: 'g.paved', name: '铺地占比', high: '铺地多', f: d => frac(d.n.paved, d.n.paved + d.n.grass + d.n.wall) },
  { id: 'g.grass', name: '草地占比', high: '草地多', f: d => frac(d.n.grass, d.n.paved + d.n.grass + d.n.wall) },
  { id: 'g.wall', name: '墙（楼）占比', high: '楼多', f: d => frac(d.n.wall, d.n.paved + d.n.grass + d.n.wall) },
  { id: 'g.other', name: '其他地面占比', high: '沙、土、水等其他地面多', f: d => frac(d.n.other, d.valid) },
  { id: 'd.curb', name: '路缘设施密度', high: '路灯、红绿灯、消防栓、护柱、井盖多', f: density('curb') },
  { id: 'd.plant', name: '植物密度', high: '树和植物多', f: density('plant') },
  { id: 'd.trash', name: '垃圾桶密度', high: '垃圾桶多', f: density('trash') },
  { id: 'd.seat', name: '座位密度', high: '长椅、桌子多', f: density('seat') },
  { id: 'd.vehicle', name: '车密度', high: '车多', f: density('vehicle') },
  { id: 'd.sign', name: '标牌密度', high: '标牌、路牌多', f: density('sign') },
  { id: 'd.other', name: '其他物件密度', high: '设备、围栏、箱子等其他物件多', f: density('other') },
  { id: 'd.all', name: '物件总密度', high: '物件多', f: d => frac(d.known.length, d.placeable) },
  { id: 'e.rect', name: '最大空地', high: '有一大块没有物件的空地', f: d => {
    const { w } = d.cx;
    const mask = Array.from({ length: WIN }, (_, i) => Array.from({ length: WIN }, (_, j) => {
      const r = d.win.r0 + i, c = d.win.c0 + j; return PLACEABLE.has(w.ground[r][c]) && !d.cx.covered[r][c];
    }));
    return frac(largestRect(mask), d.placeable);
  } },
  { id: 'e.far', name: '远离物件的地面', high: '离任何物件 32px 以上的地面多', f: d => {
    let n = 0;
    for (let r = d.win.r0; r < d.win.r0 + WIN; r++) for (let c = d.win.c0; c < d.win.c0 + WIN; c++) if (PLACEABLE.has(d.cx.w.ground[r][c]) && d.cx.far[r][c]) n++;
    return frac(n, d.placeable);
  } },
  { id: 'r.same', name: '同类扎堆', high: '同类物件挨在一起（40px 内）', f: d => frac(d.objs.filter(a => d.cx.w.objs.some(b => b !== a && b.cls === a.cls && dist(a, b) <= 40)).length, d.objs.length) },
  { id: 'r.lift', name: '常见搭配', high: '桌–椅、垃圾桶–垃圾桶、树–长椅、红绿灯–红绿灯这类搭配多', f: d => {
    let pairs = 0;
    for (let i = 0; i < d.objs.length; i++) for (let j = i + 1; j < d.objs.length; j++) {
      const a = d.objs[i], b = d.objs[j];
      if (dist(a, b) <= 40 && LIFT.some(([p, q]) => (a.cls === p && b.cls === q) || (a.cls === q && b.cls === p))) pairs++;
    }
    return frac(pairs, d.objs.length);
  } },
  { id: 'r.wall', name: '贴墙', high: '物件贴着楼（8px 内）', f: d => {
    const { w } = d.cx;
    return frac(d.objs.filter(o => {
      const [c0, r0] = cellOf(w, o.bb.x0 - 8, o.bb.y0 - 8), [c1, r1] = cellOf(w, o.bb.x1 + 7, o.bb.y1 + 7);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++)
        if (groundAt(w, c, r) === 'wall' && gap(o.bb, { x0: w.ox + c * T, y0: w.oy + r * T, x1: w.ox + (c + 1) * T, y1: w.oy + (r + 1) * T }) <= 8) return true;
      return false;
    }).length, d.objs.length);
  } },
  { id: 'r.curb', name: '贴路缘', high: '物件立在路缘边（8px 内）', f: d => frac(d.objs.filter(o => curbDist(d.cx.w, o.fx, o.fy - 1) <= 8).length, d.objs.length) },
  { id: 'r.road', name: '站在马路上', high: '车和井盖以外的物件站在马路上', f: d => frac(d.objs.filter(o => o.cls !== 'vehicle' && o.cls !== 'manhole' && groundAt(d.cx.w, ...cellOf(d.cx.w, o.fx, o.fy - 1)) === 'road').length, d.objs.length) },
  { id: 'p.tex', name: '同一贴图重复', high: '同一张贴图在窗口里出现多次', f: d => {
    const n = new Map<string, number>(); for (const o of d.known) n.set(o.key, (n.get(o.key) ?? 0) + 1);
    return frac(d.known.filter(o => n.get(o.key)! >= 2).length, d.known.length);
  } },
  { id: 'p.row', name: '成排等距', high: '物件排成等距的一排（3 个以上）', f: d => frac(rowMembers(d.known).size, d.known.length) },
  { id: 'p.keys', name: '贴图种类', high: '物件的贴图各不相同', f: d => frac(new Set(d.known.map(o => o.key)).size, d.known.length) },
  { id: 's.straight', name: '长直边', high: '草地和铺地的边界是长直线（≥4 格）', f: d => { const b = boundary(d); return frac(b.straight, b.edges); } },
  { id: 's.corner', name: '转角数', high: '草地边界转角多（每 100 格）', f: d => frac(boundary(d).corners * 100, d.valid) },
];

export function activeFeatures(blacklist: readonly string[] = blacklistRaw as string[]): Feature[] {
  return FEATURES.filter(f => !blacklist.includes(f.id));
}

export function featCtx(w: JWorld): FeatCtx {
  const covered = w.ground.map(row => row.map(() => false));
  const far = w.ground.map(row => row.map(() => true));
  for (const o of w.objs) {
    const [c0, r0] = cellOf(w, o.bb.x0, o.bb.y0), [c1, r1] = cellOf(w, o.bb.x1 - 1, o.bb.y1 - 1);
    for (let r = Math.max(0, r0); r <= Math.min(w.rows - 1, r1); r++) for (let c = Math.max(0, c0); c <= Math.min(w.cols - 1, c1); c++) covered[r][c] = true;
    const [f0, g0] = cellOf(w, o.bb.x0 - 40, o.bb.y0 - 40), [f1, g1] = cellOf(w, o.bb.x1 + 40, o.bb.y1 + 40);
    for (let r = Math.max(0, g0); r <= Math.min(w.rows - 1, g1); r++) for (let c = Math.max(0, f0); c <= Math.min(w.cols - 1, f1); c++) {
      if (!far[r][c]) continue;
      const x = w.ox + c * T + T / 2, y = w.oy + r * T + T / 2;
      if (gap(o.bb, { x0: x, y0: y, x1: x, y1: y }) < 32) far[r][c] = false;
    }
  }
  return { w, covered, far };
}

export function winData(cx: FeatCtx, win: Win, byCell?: JObj[][][]): WinData {
  const { w } = cx;
  const n: Record<JGround, number> = { road: 0, paved: 0, grass: 0, wall: 0, other: 0, none: 0 };
  const cells: JGround[] = [];
  for (let r = win.r0; r < win.r0 + WIN; r++) for (let c = win.c0; c < win.c0 + WIN; c++) { const g = w.ground[r][c]; cells.push(g); n[g]++; }
  const inWin = (o: JObj) => o.fx >= win.rect.x0 && o.fx < win.rect.x1 && o.fy - 1 >= win.rect.y0 && o.fy - 1 < win.rect.y1;
  let objs: JObj[];
  if (byCell) { objs = []; for (let r = win.r0; r < win.r0 + WIN; r++) for (let c = win.c0; c < win.c0 + WIN; c++) objs.push(...(byCell[r]?.[c] ?? [])); }
  else objs = w.objs.filter(inWin);
  return { win, cx, cells, n, valid: WIN * WIN - n.none, placeable: n.paved + n.grass + n.other, objs, known: objs.some(o => o.novel) ? objs.filter(o => !o.novel) : objs };
}

/** rows = windows, columns = activeFeatures() (or the given features) */
export function featureMatrix(w: JWorld, wins: Win[], feats: Feature[] = activeFeatures()): number[][] {
  const cx = featCtx(w);
  // objects by the cell their foot stands in (feet on the map edge or outside belong to no window)
  const byCell: JObj[][][] = w.ground.map(row => row.map(() => []));
  for (const o of w.objs) { const [c, r] = cellOf(w, o.fx, o.fy - 1); byCell[r]?.[c]?.push(o); }
  return wins.map(win => { const d = winData(cx, win, byCell); return feats.map(f => f.f(d)); });
}
