// Neighbouring blocks (context around the main block), packed with the same packer as the main block.
// Buildings may run off the picture edge; regions south of a street show roofs/backs to it.
import { Rng } from './rng';
import type { Layout } from './layout';
import type { BlockPlan, PlacedBuilding } from './block';
import { pack } from './pack';
import { pickBuilding } from './buildings';

export function planNeighbours(L: Layout, r0: Rng, composite?: { r: Rng; p: number }, kits?: { r: Rng; p: number }): BlockPlan {
  const r = r0.fork('neigh');
  // pack on an extended grid: virtual cells beyond the picture edge continue the edge cell, so shallow
  // visible strips of neighbour blocks still get (partially visible) buildings
  const E = 14, EB = 3;   // virtual margin; only 3 rows below so bottom-aligned buildings still reach into view
  // virtual cell beyond the edge: same region as the clamped edge cell, road distance grows with the overflow
  const virt = (x: number, y: number) => {
    const cx = Math.min(L.cols - 1, Math.max(0, x)), cy = Math.min(L.rows - 1, Math.max(0, y));
    if (cx === x && cy === y) return L.cls[y][x] === 'nlot';
    if (L.region[cy][cx] < 0) return false;
    return L.roadDist[cy][cx] + Math.max(Math.abs(x - cx), Math.abs(y - cy)) > L.sw2;
  };
  const { placed: pe } = pack({
    cols: L.cols + 2 * E, rows: L.rows + E + EB, buildable: (x, y) => virt(x - E, y - E), canopy: (x, y) => virt(x - E, y - E),
    mix: { modular: 2, single: 2 }, minH: 7, gapAfter: [[0, 4], [1, 3], [2, 2]], pairChance: 0.3, composite: composite && { r: composite.r.fork('neigh'), p: composite.p }, kits: kits && { r: kits.r.fork('neigh'), p: kits.p },
  }, r);
  const placed = pe.map(p => ({ ...p, cx: p.cx - E, cy: p.cy - E, why: `邻近街区（同一打包器；画面外按到路的距离延续地块）。${p.why}` }))
    .filter(p => p.cx + p.plan.w > 0 && p.cy + p.plan.h > 0 && p.cx < L.cols && p.cy < L.rows);
  // regions cut by the picture bottom with a street above: buildings top-aligned to their street, running
  // off the bottom edge (we see roofs and upper floors)
  const covered = L.cls.map(row => row.map(() => false));
  for (const p of placed) for (let y = Math.max(0, p.cy + p.plan.h - p.plan.foot); y < Math.min(L.rows, p.cy + p.plan.h); y++) for (let x = Math.max(0, p.cx); x < Math.min(L.cols, p.cx + p.plan.w); x++) covered[y][x] = true;
  const topRow = new Map<number, number>();
  for (let x = 0; x < L.cols; x++) {
    if (L.cls[L.rows - 1][x] !== 'nlot' && L.cls[L.rows - 1][x] !== 'nwalk') continue;
    let y = L.rows - 1; while (y > 0 && L.cls[y - 1][x] === 'nlot') y--;
    if (L.cls[y][x] === 'nlot' && !covered[y][x]) topRow.set(x, y);
  }
  let x = 0;
  while (x < L.cols) {
    if (!topRow.has(x)) { x++; continue; }
    const y = topRow.get(x)!;
    const b = pickBuilding(r, 16, 9, 30, { modular: 2, single: 2 });
    let ok = !!b;
    if (b) for (let xx = x; xx < Math.min(L.cols, x + b.w); xx++) if (topRow.get(xx) !== y) ok = false;
    if (b && ok) { placed.push({ plan: b, cx: x, cy: y, why: '邻近街区：画面下沿被裁切的地块，楼顶对齐街道、向下伸出画面（看到屋顶和上层）' }); x += b.w + r.choose('neigh.gap', {}, { weights: [[0, 3], [1, 2], [2, 1]] as const }); } else x++;
  }
  const yard = L.cls.map(row => row.map(() => false));
  const buildings: PlacedBuilding[] = placed.map(p => {
    const below = L.cls[p.cy + p.plan.h]?.[p.cx];
    return { plan: p.plan, cx: p.cx, cy: p.cy, side: (below === 'nwalk' ? 'S' : 'N') as 'S' | 'N', why: p.why };
  });
  return { buildings, zones: [], yard, yb: new Map(), yt: new Map() };
}
