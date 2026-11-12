// v0.8.2: the centre of a big city block (spec 3.3). A big plain rect block keeps its middle for a plaza (garden in
// residential areas): the lot is inset (south more, for the frontage row and its yard), and passages 2-3 cells wide
// lead to it from the south frontage and from one other side. Carved before packing (planMainBlock), so no building
// stands on it; the yard does not get its cells.
import type { Rng } from './rng';
import type { Layout } from './layout';
import { slab } from './layout';
import type { BlockPlan, Zone } from './block';
import { SceneBuilder, rect } from './place';
import { lawn } from './district';
import { TILE, type Scene } from './types';
import { buildGraph } from './rational/graph';
import { worldFromScene } from './rational/world';

/** lot cells kept for buildings on each side */
export const CENTRE_INSET = { s: 14, n: 10, e: 10, w: 10 } as const;
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

/** the centre's ground, zone, group and the passages kept clear (objects: v0.8.2 Task 5) */
export function centreVignettes(L: Layout, plan: BlockPlan, sb: SceneBuilder, _r: Rng): void {
  const a = plan.centre;
  if (!a) return;
  if (a.kind === 'plaza') {
    for (let y = a.y0; y < a.y1; y++) for (let x = a.x0; x < a.x1; x++) L.base[y][x] = slab(L.mainStyle, x, y);
  } else lawn(L, a);
  const T = TILE, px = rect(a.x0 * T, a.y0 * T, a.x1 * T, a.y1 * T);
  const gid = sb.group('centre', a.why, { anchor: { kind: 'zone', ref: `centre@${a.x0},${a.y0}`, x: (a.x0 + a.x1) * T / 2, y: a.y1 * T } });
  sb.zone('block', 'centre', px, a.why, gid);
  // each passage, out onto the sidewalk at its street end and 2 cells into the centre at the other
  for (const z of plan.zones.filter(q => q.toCentre)) {
    let { x0, y0, x1, y1 } = z;
    if (z.y0 >= a.y1) { y1 += L.sw; y0 -= 2; }
    else if (z.y1 <= a.y0) { y0 -= L.sw; y1 += 2; }
    else if (z.x0 >= a.x1) { x1 += L.sw; x0 -= 2; }
    else { x0 -= L.sw; x1 += 2; }
    sb.clear(rect(x0 * T, y0 * T, x1 * T, y1 * T), 'alley', '通往中心的通道保持畅通', gid);
  }
}

/** the 'centre' zone's place has a walkable component rooted at the street */
export function centreReachable(sc: Scene): boolean {
  const g = buildGraph(worldFromScene(sc));
  const place = g.places.find(p => p.kind === 'centre');
  return !!place && [...place.comps].some(c => g.compRoots[c].has('street'));
}
