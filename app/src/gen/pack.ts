// Generic building packer for a region of cells.
// Repeatedly takes the lowest row that still has free cells and places a building bottom-aligned there.
// A building whose front would face the back of another building keeps a 2-row clearance (front yard).
// Cells that cannot take a building become 'yard'.
import { Rng } from './rng';
import { pickBuilding, modularStack, type BuildingPlan, type FrontKind } from './buildings';

export interface PackOpts {
  cols: number; rows: number;
  /** cell may hold a building */
  buildable: (x: number, y: number) => boolean;
  /** cell outside the picture that counts as buildable (buildings may run off the picture edge) */
  overflow?: (x: number, y: number) => boolean;
  /** cell is a building already (for front clearance) */
  mix: { modular: number; single: number };
  minH?: number;
  /** allowed building fronts for a placement whose facade bottom row is `bottom` at columns x0..x0+w-1 */
  frontFilter?: (x0: number, w: number, bottom: number) => FrontKind[] | null;
  gapAfter?: readonly (readonly [number, number])[];
  pairChance?: number;
}

export interface Packed { plan: BuildingPlan; cx: number; cy: number }

export function pack(o: PackOpts, r: Rng): { placed: Packed[]; yard: boolean[][] } {
  const { cols, rows } = o;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < cols && y < rows;
  const free = Array.from({ length: rows }, (_, y) => Array.from({ length: cols }, (_, x) => o.buildable(x, y)));
  const bld = Array.from({ length: rows }, () => Array<boolean>(cols).fill(false));
  const yard = Array.from({ length: rows }, () => Array<boolean>(cols).fill(false));
  const ok = (x: number, y: number) => inside(x, y) ? free[y][x] : !!o.overflow?.(x, y);
  const placed: Packed[] = [];
  const fits = (b: BuildingPlan, x0: number, bottom: number) => {
    for (let y = bottom - b.h + 1; y <= bottom; y++) for (let x = x0; x < x0 + b.w; x++) if (!ok(x, y)) return false;
    // front clearance: the 2 rows below must not be building
    for (let y = bottom + 1; y <= bottom + 2; y++) for (let x = x0; x < x0 + b.w; x++) if (inside(x, y) && bld[y][x]) return false;
    return true;
  };
  const mark = (b: BuildingPlan, x0: number, bottom: number) => {
    for (let y = bottom - b.h + 1; y <= bottom; y++) for (let x = x0; x < x0 + b.w; x++) if (inside(x, y)) { free[y][x] = false; bld[y][x] = true; }
  };
  for (let iter = 0; iter < 2000; iter++) {
    // lowest row with a free cell
    let yS = -1;
    for (let y = rows - 1; y >= 0 && yS < 0; y--) for (let x = 0; x < cols; x++) if (free[y][x]) { yS = y; break; }
    if (yS < 0) break;
    // a random free run in that row
    const runs: [number, number][] = [];
    for (let x = 0; x < cols; x++) { if (!free[yS][x]) continue; let e = x; while (e < cols && free[yS][e]) e++; runs.push([x, e]); x = e; }
    const [a, b] = r.pick(runs);
    let x = a;
    while (x < b) {
      // extend the run through overflow on the right edge
      const rem = b - x + (b === cols && o.overflow ? 12 : 0);
      // height available above (min over a 6-wide window), overflow above the picture counts as unlimited
      let avail = 0;
      for (let y = yS; ok(x, y) && avail < 40; y--) avail++;
      let bp: BuildingPlan | null = null;
      if (rem >= 5 && avail >= (o.minH ?? 8)) {
        for (let t = 0; t < 8 && !bp; t++) {
          // fronts allowed here depend on what lies in front of the facade (street vs inner yard)
          const allow = o.frontFilter ? o.frontFilter(x, Math.min(rem, 7), yS) : null;
          const c = pickBuilding(r, rem, o.minH ?? 8, avail, o.mix, allow ?? undefined);
          if (c && fits(c, x, yS) && (!o.frontFilter || !o.frontFilter(x, c.w, yS) || o.frontFilter(x, c.w, yS)!.includes(c.front))) bp = c;
        }
      }
      if (!bp) { yard[yS][x] = inside(x, yS); free[yS][x] = false; x++; continue; }
      placed.push({ plan: bp, cx: x, cy: yS - bp.h + 1 }); mark(bp, x, yS);
      x += bp.w;
      // continuous facade: a second modular stack in the same colourway right next to it
      const m = bp.label.split('/');
      if (m.length === 3 && r.chance(o.pairChance ?? 0.35)) {
        // same colourway and height, but never the same storefront family twice in a row
        const b2 = modularStack(r, { colour: m[1] as 'red' | 'blue' | 'grey', floors: +m[2][0], avoidFamily: m[0] });
        const allow2 = o.frontFilter ? o.frontFilter(x, b2.w, yS) : null;
        if (b2.h === bp.h && fits(b2, x, yS) && (!allow2 || allow2.includes(b2.front))) { placed.push({ plan: b2, cx: x, cy: yS - b2.h + 1 }); mark(b2, x, yS); x += b2.w; }
      }
      const gap = r.weighted(o.gapAfter ?? [[0, 5], [1, 2], [2, 1]]);
      for (let g = 0; g < gap && x < b; g++, x++) { yard[yS][x] = true; free[yS][x] = false; }
    }
  }
  // free cells left over are yard too
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (free[y][x]) yard[y][x] = true;
  return { placed, yard };
}
