// Generic building packer for a region of cells.
// Repeatedly takes the lowest row that still has free cells and places a building bottom-aligned there.
// Only the footprint (bottom `foot` rows) takes space; the upper floors take none (D38): the ground they cover
// stays free for yard or other footprints, they only have to stay over the block's own lot (`canopy`).
// A building whose front would face the back of another building keeps a 2-row clearance (front yard).
// Cells that cannot take a building become 'yard'.
// `spread` (exp-03, adopted 2026-11-04, NOTE D51/D52): afterwards every building with another one in front of it slides north until its footprint reaches
// the lot's north edge, so the rows behind stand clear of the front row's upper floors instead of packing tight against
// its footprint; its own upper floors may then hang over the north sidewalk / street (or off the picture).
import { Rng } from './rng';
import { pickBuilding, modularStack, type BuildingPlan, type FrontKind } from './buildings';
import { terraceSection, condoBays, terracedRow } from './terrace';
import { condo3, condo4Row, condo4Tower, condo7Row, office, hotel } from './kits';

export interface PackOpts {
  cols: number; rows: number;
  /** cell may hold a building */
  buildable: (x: number, y: number) => boolean;
  /** cell outside the picture that counts as buildable (buildings may run off the picture edge) */
  overflow?: (x: number, y: number) => boolean;
  /** cell the upper floors may hang over (in the picture this hides it): the block's own lot, never a street */
  canopy: (x: number, y: number) => boolean;
  /** cell is a building already (for front clearance) */
  mix: { modular: number; single: number };
  minH?: number;
  /** allowed building fronts for a placement whose facade bottom row is `bottom` at columns x0..x0+w-1 */
  frontFilter?: (x0: number, w: number, bottom: number) => FrontKind[] | null;
  gapAfter?: readonly (readonly [number, number])[];
  pairChance?: number;
  /** slide the buildings behind other buildings north until their footprint reaches the lot's north edge (D51) */
  spread?: boolean;
  /** exp-04: buildings put together from parts, proposed on the experiment's own stream with chance p per occasion;
   *  buildings placed as one run (terrace sections, the D15 pair) then move together in `spread` */
  composite?: { r: Rng; p: number };
  /** exp-05: the packs' other building kits (kits.ts) in place of the picked building, on the experiment's own stream */
  kits?: { r: Rng; p: number };
  /** city mode (spec 4): a building sprite's top row may not be above topLimit(x), for every column x it covers */
  topLimit?: (x: number) => number;
}

export interface Packed { plan: BuildingPlan; cx: number; cy: number; why: string; /** rows slid north by `spread` */ moved?: number;
  /** exp-04: buildings placed side by side as one run (id of the first) */ run?: string }

export function pack(o: PackOpts, r: Rng): { placed: Packed[]; yard: boolean[][] } {
  const { cols, rows } = o;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < cols && y < rows;
  const free = Array.from({ length: rows }, (_, y) => Array.from({ length: cols }, (_, x) => o.buildable(x, y)));
  const bld = Array.from({ length: rows }, () => Array<boolean>(cols).fill(false));
  const yard = Array.from({ length: rows }, () => Array<boolean>(cols).fill(false));
  const ok = (x: number, y: number) => inside(x, y) ? free[y][x] : !!o.overflow?.(x, y);
  const over = (x: number, y: number) => inside(x, y) ? o.canopy(x, y) : !!o.overflow?.(x, y);
  const placed: Packed[] = [];
  const fits = (b: BuildingPlan, x0: number, bottom: number) => {
    if (!underTop(o, x0, b.w, bottom - b.h + 1)) return false;
    for (let y = bottom - b.foot + 1; y <= bottom; y++) for (let x = x0; x < x0 + b.w; x++) if (!ok(x, y)) return false;
    for (let y = bottom - b.h + 1; y <= bottom - b.foot; y++) for (let x = x0; x < x0 + b.w; x++) if (!over(x, y)) return false;
    // front clearance: the 2 rows below must not be building
    for (let y = bottom + 1; y <= bottom + 2; y++) for (let x = x0; x < x0 + b.w; x++) if (inside(x, y) && bld[y][x]) return false;
    return true;
  };
  const mark = (b: BuildingPlan, x0: number, bottom: number) => {
    for (let y = bottom - b.foot + 1; y <= bottom; y++) for (let x = x0; x < x0 + b.w; x++) if (inside(x, y)) { free[y][x] = false; bld[y][x] = true; }
  };
  for (let iter = 0; iter < 2000; iter++) {
    // lowest row with a free cell
    let yS = -1;
    for (let y = rows - 1; y >= 0 && yS < 0; y--) for (let x = 0; x < cols; x++) if (free[y][x]) { yS = y; break; }
    if (yS < 0) break;
    // a random free run in that row
    const runs: [number, number][] = [];
    for (let x = 0; x < cols; x++) { if (!free[yS][x]) continue; let e = x; while (e < cols && free[yS][e]) e++; runs.push([x, e]); x = e; }
    const [a, b] = r.choose('pack.run', { row: yS }, runs);
    let x = a;
    while (x < b) {
      // extend the run through overflow on the right edge
      const rem = b - x + (b === cols && o.overflow ? 12 : 0);
      // sprite height available above (the upper floors may hang over the lot), overflow above the picture counts
      // as unlimited; whether the footprint itself is free is checked by fits()
      let avail = 0;
      for (let y = yS; (y === yS || over(x, y)) && avail < 40; y--) avail++;
      let bp: BuildingPlan | null = null;
      if (rem >= 5 && avail >= (o.minH ?? 8)) {
        for (let t = 0; t < 8 && !bp; t++) {
          const mk = r.mark();
          // fronts allowed here depend on what lies in front of the facade (street vs inner yard)
          const allow = o.frontFilter ? o.frontFilter(x, Math.min(rem, 7), yS) : null;
          const c = pickBuilding(r, rem, o.minH ?? 8, avail, o.mix, allow ?? undefined);
          if (c && fits(c, x, yS) && (!o.frontFilter || !o.frontFilter(x, c.w, yS) || o.frontFilter(x, c.w, yS)!.includes(c.front))) bp = c;
          else r.reject(mk, 'building:slot');
        }
      }
      if (!bp) { yard[yS][x] = inside(x, yS); free[yS][x] = false; x++; continue; }
      let note = '';
      if (o.composite) {
        // exp-04: the picked single building gives way to one put together from parts (same kind of front)
        const c = composed(o.composite, bp, rem, avail, o.minH ?? 8);
        const allowC = c && o.frontFilter ? o.frontFilter(x, c.plan.w, yS) : null;
        if (c && fits(c.plan, x, yS) && (!allowC || allowC.includes(c.plan.front))) { bp = c.plan; note = `；${c.why}`; }
      }
      if (o.kits && !note) {
        // exp-05: a kit building (Condo_3/4/7, office, hotel) with the same kind of front, where it fits
        const k = kitSwap(o.kits, bp, rem, avail, o.minH ?? 8);
        const allowK = k && o.frontFilter ? o.frontFilter(x, k.plan.w, yS) : null;
        if (k && fits(k.plan, x, yS) && (!allowK || allowK.includes(k.plan.front))) { bp = k.plan; note = `；${k.why}`; }
      }
      const allowed = o.frontFilter ? o.frontFilter(x, bp.w, yS) : null;
      const first: Packed = { plan: bp, cx: x, cy: yS - bp.h + 1, why: `打包：第 ${yS} 行是最低的空行，放在空段 ${a}–${b - 1} 的 x=${x} 处，底边对齐；${!o.frontFilter ? '' : allowed ? '立面不临街 → 只能是住宅；' : '立面临街 → 可为店铺；'}可用高度 ${avail} 格${note}` };
      placed.push(first);
      mark(bp, x, yS);
      x += bp.w;
      let last = bp, sections = 1;
      // continuous facade: a second modular stack in the same colourway right next to it
      const m = bp.label.split('/');
      if (m.length === 3 && r.choose('pack.pair', {}, { p: o.pairChance ?? 0.35 })) {
        // same colourway and height, but never the same storefront family twice in a row
        const mk = r.mark();
        const b2 = modularStack(r, { colour: m[1] as 'red' | 'blue' | 'grey', floors: +m[2][0], avoidFamily: m[0] });
        const allow2 = o.frontFilter ? o.frontFilter(x, b2.w, yS) : null;
        if (b2.h === bp.h && fits(b2, x, yS) && (!allow2 || allow2.includes(b2.front))) {
          placed.push({ plan: b2, cx: x, cy: yS - b2.h + 1, why: `连续立面：紧接 ${bp.id}（${bp.label}），同色同高，但底商换一家（D15）`, ...(o.composite ? { run: bp.id } : {}) });
          mark(b2, x, yS); x += b2.w; last = b2; sections++; if (o.composite) first.run = bp.id;
        }
        else r.reject(mk, 'building:pair');
      }
      // exp-04: the floor-modular building grows into a terrace of up to 3 sections (own storefronts, one colourway)
      const cr = o.composite?.r;
      if (cr && m.length === 3 && sections < 3 && cr.choose('terrace.grow', { sections }, { p: o.composite!.p })) {
        const want = sections === 1 ? cr.choose('terrace.more', {}, [1, 2]) : 1;
        for (let i = 0; i < want; i++) {
          const f0 = +last.label.split('/')[2][0];
          const floors = cr.choose('terrace.floors', { f0 }, { weights: [[f0, 2], [Math.max(0, f0 - 1), 1], [Math.min(3, f0 + 1), 1]] as const });
          const allow3 = o.frontFilter ? o.frontFilter(x, 7, yS) : null;
          const s3 = terraceSection(cr, last, { floors, avoidFamily: last.label.split('/')[0], front: allow3 ? 'condo' : undefined });
          if (!s3 || !fits(s3, x, yS) || (allow3 && !allow3.includes(s3.front))) break;
          placed.push({ plan: s3, cx: x, cy: yS - s3.h + 1, run: bp.id,
            why: `拼接楼：${bp.id} 的第 ${sections + 1} 段，紧接 ${last.id}（${last.label}），同一色系、${floors === f0 ? '同高' : floors > f0 ? '高一层' : '矮一层'}，底商换一家` });
          first.run = bp.id;
          mark(s3, x, yS); x += s3.w; last = s3; sections++;
        }
      }
      const gap = r.choose('pack.gap', {}, { weights: o.gapAfter ?? [[0, 5], [1, 2], [2, 1]] });
      for (let g = 0; g < gap && x < b; g++, x++) { yard[yS][x] = true; free[yS][x] = false; }
    }
  }
  if (o.spread) spreadNorth(o, placed, bld, free, yard);
  // free cells left over are yard too
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (free[y][x]) yard[y][x] = true;
  return { placed, yard };
}

/** the sprite's top row `top` over columns x0..x0+w-1 is not above `topLimit` (no limit: always true) */
function underTop(o: PackOpts, x0: number, w: number, top: number): boolean {
  if (!o.topLimit) return true;
  for (let x = x0; x < x0 + w; x++) if (top < o.topLimit(x)) return false;
  return true;
}

/** exp-04: a building put together from parts in place of `bp` (same kind of front), or null */
function composed(c: { r: Rng; p: number }, bp: BuildingPlan, rem: number, avail: number, minH: number): { plan: BuildingPlan; why: string } | null {
  const single = bp.parts.length === 1 && bp.parts[0].role === 'whole';
  if (!single) return null;
  if ((bp.front !== 'condo' && bp.front !== 'house') || !c.r.choose('composite.swap', { front: bp.front }, { p: c.p })) return null;
  // residential either way: condo bays (Condo_1/2) or a row of terraced houses
  const kinds = [...(bp.front === 'condo' && bp.w % 2 === 0 && bp.w <= 12 ? [['bays', 3] as const] : []), ...(rem >= 20 ? [['row', 1] as const] : [])];
  if (!kinds.length) return null;
  if (c.r.choose('composite.kind', { front: bp.front }, { weights: kinds }) === 'bays') {
    // mostly the same width (the packing stays as it was), sometimes one to three middle bays more where the run allows
    const ws = [0, 2, 4, 6].map(d => bp.w + d).filter(w => w <= Math.min(rem, 12));
    const w = c.r.choose('condoBays.width', { w: bp.w }, { weights: ws.map((x, i) => [x, i ? 1 : 3] as const) });
    const p = condoBays(c.r, w, avail);
    if (p && p.h >= minH) return { plan: p, why: `拼接楼：原本抽到 ${bp.label}（${bp.w} 格宽），换成${w === bp.w ? '同宽' : ` ${w} 格宽`}的分段公寓（左段带门 + ${(w - 4) / 2} 个中段 + 右端头）` };
    return null;
  }
  const n = rem >= 30 ? c.r.choose('terracedRow.n', {}, [2, 3]) : 2;
  const p = terracedRow(c.r, n, avail);
  if (p && p.h >= minH) return { plan: p, why: `拼接楼：原本抽到 ${bp.label}，换成 ${n} 户相连的联排住宅（Terraced_House_Modular）` };
  return null;
}

/** exp-05: a kit building in place of `bp` (residential for residential, office / hotel for a shop), or null.
 *  Sizes are drawn within the free run `rem` and the height `avail`; fits() still checks the footprint. */
function kitSwap(c: { r: Rng; p: number }, bp: BuildingPlan, rem: number, avail: number, minH: number): { plan: BuildingPlan; why: string } | null {
  const r = c.r;
  const res = bp.front === 'condo' || bp.front === 'house';
  // shops are the street's life: a shop gives way half as often as a residential building
  if (!r.choose('kit.swap', { res }, { p: res ? c.p : c.p / 2 })) return null;
  const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);
  type K = 'condo3' | 'condo4' | 'tower' | 'condo7' | 'office' | 'hotel';
  const ok: Record<K, boolean> = {
    condo3: res && rem >= 5 && avail >= 11, condo4: res && rem >= 12 && avail >= 15, tower: res && rem >= 6 && avail >= 13, condo7: res && rem >= 6 && avail >= 12,
    office: !res && rem >= 7 && avail >= 11, hotel: !res && rem >= 17 && avail >= 18,
  };
  const W: [K, number][] = ([['condo3', 2], ['condo4', 3], ['tower', 1], ['condo7', 2], ['office', 2], ['hotel', 2]] as [K, number][]).filter(([k]) => ok[k]);
  if (!W.length) return null;
  const kind = r.choose('kit.kind', { res }, { weights: W });
  const was = `原本抽到 ${bp.label}（${bp.w} 格宽）`;
  let p: BuildingPlan | null = null, why = '';
  switch (kind) {
    case 'condo3': {
      const ws = range(Math.max(5, bp.w - 2), Math.min(rem, bp.w + 4, 14));
      if (!ws.length) return null;
      const w = r.choose('kit.condo3.w', {}, ws);
      p = condo3(r, w); why = `${w} 格宽的 Condo_3 砖楼（左右端 + 墙段 + 门段拼成，两层，窗户和花箱逐个放）`; break;
    }
    case 'condo4': {
      const m = r.choose('kit.condo4.m', {}, range(0, Math.min(3, Math.floor((rem - 12) / 4))));
      const n = r.choose('kit.condo4.n', {}, range(0, Math.min(2, Math.floor((avail - 15) / 3))));
      p = condo4Row(r, m, n); why = `Condo_4 红砖公寓（凸窗转角段 + ${m} 个平段 + 拱门端段，${n + 2} 层）`; break;
    }
    case 'tower': {
      const n = r.choose('kit.tower.n', {}, range(0, Math.min(2, Math.floor((avail - 13) / 3))));
      p = condo4Tower(n); why = `Condo_4 八角塔楼（${n + 2} 层）`; break;
    }
    case 'condo7': {
      const k = r.choose('kit.condo7.k', {}, range(2, Math.min(4, Math.floor(rem / 3))));
      p = condo7Row(r, k, avail); why = `${k} 栋相连的 Condo_7 窄楼（每栋顶 + 中段 × n + 底，高度各不相同）`; break;
    }
    case 'office': {
      const k = r.choose('kit.office.k', {}, range(1, Math.min(4, Math.floor((rem - 4) / 3))));
      const f = r.choose('kit.office.f', {}, range(1, Math.min(5, Math.floor((avail - 5) / 3) - 1)));
      p = office(r, k, f); why = `${4 + 3 * k} 格宽、${f + 1} 层的办公楼（屋顶 / 两层一块的楼体 / 底层入口拼成，每层一种窗）`; break;
    }
    case 'hotel': {
      const n = r.choose('kit.hotel.n', {}, range(0, Math.min(3, Math.floor((avail - 18) / 4))));
      const e = r.choose('kit.hotel.e', {}, range(0, Math.min(2, avail - 18 - 4 * n)));
      p = hotel(n, e); why = `${n + 2} 层的酒店（顶 + 屋顶行 × ${e} + 顶层 + 标准层 × ${n} + 底层）`; break;
    }
  }
  if (!p || p.h < minH || p.h > avail || p.w > rem) return null;
  return { plan: p, why: `拼接楼：${was}，换成${why}` };
}

/** `spread`: northmost first, each building that has a building in front (overlapping columns, further south) slides
 *  north one row at a time while its footprint stays on buildable cells inside the picture, the 2 rows in front of every
 *  facade stay clear and the allowed fronts still allow it. The upper floors are not held to the lot (user 2026-11-04:
 *  the footprint goes all the way north, not just the roof) */
function spreadNorth(o: PackOpts, placed: Packed[], bld: boolean[][], free: boolean[][], yard: boolean[][]) {
  const { cols, rows } = o;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < cols && y < rows;
  const bottom = (p: Packed) => p.cy + p.plan.h - 1;
  const set = (p: Packed, v: boolean) => {
    for (let y = bottom(p) - p.plan.foot + 1; y <= bottom(p); y++) for (let x = p.cx; x < p.cx + p.plan.w; x++) if (inside(x, y)) {
      bld[y][x] = v; free[y][x] = !v; yard[y][x] = false;
    }
  };
  const fitsAt = (p: Packed, bot: number) => {
    const b = p.plan, x0 = p.cx;
    if (!underTop(o, x0, b.w, bot - b.h + 1)) return false;
    for (let y = bot - b.foot + 1; y <= bot; y++) for (let x = x0; x < x0 + b.w; x++) {
      if (!inside(x, y) || !o.buildable(x, y) || bld[y][x]) return false;
      // the footprint must not stand in the 2 rows in front of another facade
      if ((inside(x, y - 1) && bld[y - 1][x]) || (inside(x, y - 2) && bld[y - 2][x])) return false;
    }
    for (let y = bot + 1; y <= bot + 2; y++) for (let x = x0; x < x0 + b.w; x++) if (inside(x, y) && bld[y][x]) return false;
    const allow = o.frontFilter?.(x0, b.w, bot);
    return !allow || allow.includes(b.front);
  };
  const done = new Set<Packed>();
  for (const p of [...placed].sort((a, b) => bottom(a) - bottom(b))) {
    if (done.has(p)) continue;
    // exp-04: a run (terrace sections, pair) moves as one, so it stays linked
    const unit = p.run ? placed.filter(q => q.run === p.run) : [p];
    unit.forEach(q => done.add(q));
    const behind = unit.some(u => placed.some(q => !unit.includes(q) && bottom(q) > bottom(u) && q.cx < u.cx + u.plan.w && u.cx < q.cx + q.plan.w));
    if (!behind) continue;
    unit.forEach(u => set(u, false));
    let d = 0;
    while (unit.every(u => fitsAt(u, bottom(u) - d - 1))) d++;
    for (const u of unit) if (d > 0) { u.cy -= d; u.moved = d; u.why += `；前后排拉开：前面有楼，整栋${unit.length > 1 ? `（连同相连的 ${unit.length - 1} 栋）` : ''}向北推了 ${d} 行（占地推到不能再推，楼上层可以伸出地块）`; }
    unit.forEach(u => set(u, true));
  }
}
