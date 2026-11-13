// v0.8.3: the green island in the middle of a roundabout (spec 2.4). City mode only: the world hands over the island
// block (Layout.shape === 'roundabout', lot = L.inP). Nobody walks there: lawn, one centre piece (fountain / statue /
// big tree) in the middle, a small tree or shrub in each corner, flower beds beside the piece on a big enough lot.
import type { Rng } from './rng';
import type { Layout } from './layout';
import { SceneBuilder, rect } from './place';
import { lawn } from './district';
import { SMALL_TREES } from './yard';
import { centrePieces } from './centre';
import { spr, variants, hasSprite } from './assets';
import { TILE } from './types';

const T = TILE, C = '3_City_Props/', G = '17_Garden/';
/** lot size from which the piece gets a flower bed on each side */
const BEDS_MIN = { w: 9, h: 7 } as const;

/** lawn over the lot, the centre piece, corner plants, flower beds; stream 'roundabout', group 'roundabout' */
export function roundaboutIsland(L: Layout, sb: SceneBuilder, r: Rng): void {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let y = 0; y < L.rows; y++) for (let x = 0; x < L.cols; x++) if (L.inP[y][x]) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1);
  }
  if (x1 < x0) return;
  const w = x1 - x0, h = y1 - y0;
  lawn(L, { x0, y0, x1, y1 });
  const X0 = x0 * T, X1 = x1 * T, Y0 = y0 * T, Y1 = y1 * T, cx = (X0 + X1) / 2, cy = (Y0 + Y1) / 2;
  const head = `环岛中间的绿岛（地块 ${w}×${h}）`;
  const gid = sb.group('roundabout', `${head}：不让人进，只种树和放中心物`, { anchor: { kind: 'zone', ref: `roundabout@${x0},${y0}`, x: cx, y: Y1 } });
  sb.zone('block', 'roundabout', rect(X0, Y0, X1, Y1), `${head}：草坪，不让人进，只种树和放中心物`, gid);

  const width = (k: string) => spr(k).bb[2] - spr(k).bb[0];
  const { fountains, statues } = centrePieces();
  const trees = [C + 'Tree_11', C + 'Tree_13'].filter(hasSprite);
  const kind = r.choose('roundabout.piece', {}, { weights: [['fountain', 3], ['statue', 2], ['tree', 2]] as const });
  const pool = kind === 'fountain' ? fountains : kind === 'statue' ? statues : trees;
  const name = (k: string) => k.includes('Fountain') ? '喷泉' : k.includes('Statue') ? '雕像' : '大树';
  const pick = pool.length ? r.choose('roundabout.model', {}, pool) : undefined;
  // the drawn piece, else smaller ones (widest first), else nothing
  const all = [...fountains, ...statues, ...trees];
  const cands = pick ? [pick, ...all.filter(k => k !== pick && width(k) <= width(pick)).sort((p, q) => width(q) - width(p))] : [];
  let used: string | null = null, cxp = cx;
  for (const k of cands) {
    const p = sb.putFoot(k, cx, cy + (name(k) === '大树' ? 16 : 12), name(k) === '大树' ? 'tree' : 'utility',
      { gid, why: `环岛中间的绿岛：不让人进，只种树和放${name(k)}${k === pick ? '' : `（抽到的 ${pick!.split('/').pop()} 放不下，换小一点的）`}` });
    if (p) { used = k; cxp = cx; break; }
  }
  // a small tree or shrub in each corner, a cell in; skipped when it does not fit
  const shrubs = ['Bush_14', 'Bush_15', 'Bush_18', 'Bush_19'].map(k => G + k).filter(hasSprite);
  const small = [...SMALL_TREES.filter(hasSprite), ...shrubs];
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const key = r.choose('roundabout.cornerModel', {}, small);
    sb.putFoot(key, sx < 0 ? X0 + 1.5 * T : X1 - 1.5 * T, sy < 0 ? Y0 + 2 * T : Y1 - T, key.includes('Tree') ? 'tree' : 'plant',
      { gid, why: '环岛中间的绿岛：四角的小树 / 灌木', pad: 2 });
  }
  // flower beds either side of the piece on a big enough lot
  if (used && w >= BEDS_MIN.w && h >= BEDS_MIN.h) {
    const off = Math.round(width(used) / 2 + T);
    for (const s of [-1, 1])
      sb.putFoot(r.choose('roundabout.flowerModel', {}, variants(C + 'Flower_Bush', [1, 2, 3])), cxp + s * off, cy + 12, 'plant', { gid, why: '环岛中间的绿岛：中心物两侧的花坛', pad: 2 });
  }
}
