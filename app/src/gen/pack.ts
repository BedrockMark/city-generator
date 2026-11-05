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
}

export interface Packed { plan: BuildingPlan; cx: number; cy: number; why: string; /** rows slid north by `spread` */ moved?: number }

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
      const allowed = o.frontFilter ? o.frontFilter(x, bp.w, yS) : null;
      placed.push({ plan: bp, cx: x, cy: yS - bp.h + 1, why: `打包：第 ${yS} 行是最低的空行，放在空段 ${a}–${b - 1} 的 x=${x} 处，底边对齐；${!o.frontFilter ? '' : allowed ? '立面不临街 → 只能是住宅；' : '立面临街 → 可为店铺；'}可用高度 ${avail} 格` });
      mark(bp, x, yS);
      x += bp.w;
      // continuous facade: a second modular stack in the same colourway right next to it
      const m = bp.label.split('/');
      if (m.length === 3 && r.choose('pack.pair', {}, { p: o.pairChance ?? 0.35 })) {
        // same colourway and height, but never the same storefront family twice in a row
        const mk = r.mark();
        const b2 = modularStack(r, { colour: m[1] as 'red' | 'blue' | 'grey', floors: +m[2][0], avoidFamily: m[0] });
        const allow2 = o.frontFilter ? o.frontFilter(x, b2.w, yS) : null;
        if (b2.h === bp.h && fits(b2, x, yS) && (!allow2 || allow2.includes(b2.front))) { placed.push({ plan: b2, cx: x, cy: yS - b2.h + 1, why: `连续立面：紧接 ${bp.id}（${bp.label}），同色同高，但底商换一家（D15）` }); mark(b2, x, yS); x += b2.w; }
        else r.reject(mk, 'building:pair');
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
    for (let y = bot - b.foot + 1; y <= bot; y++) for (let x = x0; x < x0 + b.w; x++) {
      if (!inside(x, y) || !o.buildable(x, y) || bld[y][x]) return false;
      // the footprint must not stand in the 2 rows in front of another facade
      if ((inside(x, y - 1) && bld[y - 1][x]) || (inside(x, y - 2) && bld[y - 2][x])) return false;
    }
    for (let y = bot + 1; y <= bot + 2; y++) for (let x = x0; x < x0 + b.w; x++) if (inside(x, y) && bld[y][x]) return false;
    const allow = o.frontFilter?.(x0, b.w, bot);
    return !allow || allow.includes(b.front);
  };
  for (const p of [...placed].sort((a, b) => bottom(a) - bottom(b))) {
    const behind = placed.some(q => q !== p && bottom(q) > bottom(p) && q.cx < p.cx + p.plan.w && p.cx < q.cx + q.plan.w);
    if (!behind) continue;
    set(p, false);
    let bot = bottom(p);
    while (fitsAt(p, bot - 1)) bot--;
    const d = bottom(p) - bot;
    if (d > 0) { p.cy -= d; p.moved = d; p.why += `；前后排拉开：前面有楼，整栋向北推了 ${d} 行（占地推到不能再推，楼上层可以伸出地块）`; }
    set(p, true);
  }
}
