// exp-05: the packs' other building kits (2026-11-06, user: put every other composable building into the random mix).
// Each kit is a set of pieces drawn to be put together; the builders below follow the way the pack's own examples are
// assembled (measured on the sprites, e.g. Condo_4_39 = bay + plain + door end, Hotel_1 = cap + roof row + top + floor + base):
//   - Condo_3 (brown brick, 4_Generic_Building): 11-row columns, left edge + 1-wide wall x a + 3-wide door column + wall x b
//     + right edge, with windows / flower boxes laid over the two floors;
//   - Condo_4 (red brownstone): bay corner (7) + plain sections (4) x m + arched-door end (5), 0-2 extra floors (3 rows
//     each); or the octagonal tower (6 wide);
//   - Condo_7 (3-wide narrow house): top + middle x n + bottom, windows over the wall; 2-4 of them side by side;
//   - office (16_Office, four colourways): roof left / middle x k / right over 2-floor blocks, ground-floor entrance,
//     one window style per floor, a company sign;
//   - hotel (12_Hotel_and_Hospital): cap + roof rows + top floor + repeated floors + ground floor, 17 wide, a sign on the roof.
// Everything here draws from the stream it is given (exp/exp-05/...), the buildings number apart ("k<n>", D23).
import { Rng } from './rng';
import { spr, hasSprite } from './assets';
import type { BuildingPlan } from './buildings';
import { TILE as T } from './types';

export const EXP05 = 'exp-05';

let nextKitId = 0;
const kitId = () => `k${nextKitId++}`;
export function resetKitIds() { nextKitId = 0; }

type Part = BuildingPlan['parts'][number];

/** parts in drawing order (later ones cover earlier ones) */
class Parts {
  list: Part[] = [];
  add(key: string, x: number, y: number, role: Part['role'] = 'whole') {
    if (!hasSprite(key)) throw new Error(`kit piece missing: ${key}`);
    this.list.push({ key, dx: Math.round(x), dy: Math.round(y), sub: this.list.length, role });
  }
}

const plan = (w: number, h: number, foot: number, p: Parts, doors: number[], front: BuildingPlan['front'], label: string): BuildingPlan =>
  ({ id: kitId(), w, h, foot: Math.min(foot, h), parts: p.list, doors: doors.map(d => Math.round(d * T)), front, tall: h >= 14, label, exp: EXP05 });

// ---------------------------------------------------------------------------------------------- Condo_3

const C3 = (n: number) => `4_Generic_Building/Condo_3_${n}`;
/** windows of the upper floor / beside the door: 2-wide (24-27 plain / flowers) and 1-wide (29-42) */
const C3_WIN2 = [24, 25, 26, 27];
const C3_WIN1 = [29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42];

/** brown-brick condo, 2 floors (11 rows), w >= 5: [edge][wall x a][door 3][wall x b][edge]; windows over the walls */
export function condo3(r: Rng, w: number): BuildingPlan | null {
  if (w < 5) return null;
  const inner = w - 2 - 3;
  const a = r.int(0, inner);
  const p = new Parts();
  p.add(C3(1), 0, 0);
  for (let i = 0; i < a; i++) p.add(C3(2), (1 + i) * T, 0);
  p.add(C3(3), (1 + a) * T, 0);
  for (let i = 0; i < inner - a; i++) p.add(C3(2), (4 + a + i) * T, 0);
  p.add(C3(4), (w - 1) * T, 0);
  // one window family per building (the refs keep a facade consistent); flower boxes or not per window
  const big = r.choose('condo3.windowSize', {}, { p: 0.5 });
  const win = () => C3(big ? r.choose('condo3.win2', {}, C3_WIN2) : r.choose('condo3.win1', {}, C3_WIN1));
  const ww = big ? 2 : 1;
  // free wall spans on each floor: the upper floor runs edge to edge, the ground floor around the door column
  const spans = (y: number, x0: number, x1: number) => {
    // windows spaced over [x0, x1): as many as fit with one cell between, centred
    const n = Math.floor((x1 - x0 + 1) / (ww + 1));
    if (n <= 0) return;
    const used = n * ww + (n - 1);
    const s = x0 + (x1 - x0 - used) / 2;
    for (let i = 0; i < n; i++) p.add(win(), (s + i * (ww + 1)) * T, y);
  };
  spans(5.3 * T, 1, w - 1);
  spans(8.4 * T, 1, 1 + a);
  spans(8.4 * T, 4 + a, w - 1);
  return plan(w, 11, 5, p, [1 + a + 1.5], 'condo', `Condo_3_kit/${w}w`);
}

// ---------------------------------------------------------------------------------------------- Condo_4

const C4 = (n: number) => `4_Generic_Building/Condo_4_${n}`;

/** red brownstone (Condo_4_39 grammar): bay corner 7 + plain 4 x m + arched-door end 5; roof pieces carry the top floor
 *  (10 rows), n extra floors of 3 rows, ground floor 5 rows: w = 12 + 4m, h = 15 + 3n */
export function condo4Row(r: Rng, m: number, n: number): BuildingPlan {
  const w = 12 + 4 * m, h = 15 + 3 * n;
  const p = new Parts();
  const cols: [number, number, number, number][] = [[0, 3, 2, 1], ...Array.from({ length: m }, (_, i) => [7 + 4 * i, 7, 6, 5] as [number, number, number, number]), [7 + 4 * m, 12, 11, 10]];
  for (const [x, roof, floor, ground] of cols) {
    p.add(C4(roof), x * T, 0, 'roof');
    for (let i = 0; i < n; i++) p.add(C4(floor), x * T, (10 + 3 * i) * T, 'mid');
    p.add(C4(ground), x * T, (10 + 3 * n) * T, 'ground');
  }
  // a stair housing on the roof of a plain section or the door end
  if (r.choose('condo4.roofExit', {}, { p: 0.5 })) {
    const onEnd = m === 0 || r.choose('condo4.roofExitEnd', {}, { p: 0.4 });
    if (onEnd) p.add(C4(r.choose('condo4.exitEnd', {}, [13, 14])), (7 + 4 * m) * T, 0);
    else p.add(C4(r.choose('condo4.exitPlain', {}, [8, 9])), (7 + 4 * r.int(0, m - 1)) * T, 0);
  }
  return plan(w, h, 6, p, [3.5, 7 + 4 * m + 2.5], 'condo', `Condo_4_kit/${w}w${n + 2}f`);
}

/** the octagonal brownstone tower (Condo_4_40 grammar), 6 wide: cap 3 + 1 + top 5 + floor 3 x n + ground 4 */
export function condo4Tower(n: number): BuildingPlan {
  const h = 13 + 3 * n;
  const p = new Parts();
  p.add(C4(19), 0, 0, 'roof');
  p.add(C4(18), 0, 3 * T, 'roof');
  p.add(C4(17), 0, 4 * T, 'roof');
  for (let i = 0; i < n; i++) p.add(C4(16), 0, (9 + 3 * i) * T, 'mid');
  p.add(C4(15), 0, (9 + 3 * n) * T, 'ground');
  return plan(6, h, 6, p, [3], 'condo', `Condo_4_tower/${n + 2}f`);
}

// ---------------------------------------------------------------------------------------------- Condo_7

const C7 = (s: string) => `4_Generic_Building/Condo_7_${s}`;

/** k narrow houses side by side (3 wide each): top 7 + middle 2 x n + bottom 5, windows every 26 px up the wall */
export function condo7Row(r: Rng, k: number, maxH: number): BuildingPlan | null {
  const ns: number[] = [];
  for (let i = 0; i < k; i++) {
    const opts = [0, 1, 2, 3].filter(n => 12 + 2 * n <= maxH && n !== ns[i - 1]);
    if (!opts.length) return null;
    ns.push(r.choose('condo7.middles', { i }, opts));
  }
  const h = Math.max(...ns.map(n => 12 + 2 * n));
  const p = new Parts();
  ns.forEach((n, i) => {
    const x = 3 * i * T, top = (h - 12 - 2 * n) * T;
    p.add(C7('Modular_Top'), x, top, 'roof');
    for (let j = 0; j < n; j++) p.add(C7('Modular_Middle'), x, top + (7 + 2 * j) * T, 'mid');
    const bottom = top + (7 + 2 * n) * T;
    p.add(C7('Modular_Bottom'), x, bottom, 'ground');
    // windows: one style per house, from the bottom piece up while below the roof (Condo_7_Example_2/3: 26-27 px apart)
    const win = C7(`Modular_Window_${r.choose('condo7.window', { i }, [1, 2, 3, 4, 5])}`);
    for (let y = bottom; y >= top + 5 * T; y -= 26) p.add(win, x, y);
    if (r.choose('condo7.airUnit', { i }, { p: 0.4 })) p.add(C7('Roof_Air_Unit'), x, top + T);
  });
  return plan(3 * k, h, 5, p, ns.map((_, i) => 3 * i + 1.5), 'condo', `Condo_7_row/${k}x`);
}

// ---------------------------------------------------------------------------------------------- office

const OF = (s: string) => `16_Office/${s}`;
const ROOF_PROPS = ['Roof_Prop_1', 'Roof_Prop_2', 'Roof_Prop_3', 'Air_Duct_1_Roof_Prop', 'Air_Duct_2_Roof_Prop', 'Solar_Panel_Roof_Prop'];

/** office building, w = 4 + 3k (k >= 1), f floors above the ground floor (f >= 1): h = 5 (roof) + 3 (f + 1).
 *  The body is 2-floor blocks (6 rows) stacked down from the roof, the last one overlapping when the count is odd;
 *  the ground floor gets its entrance / shutters laid over the lowest floor. */
export function office(r: Rng, k: number, f: number): BuildingPlan {
  const w = 4 + 3 * k, h = 5 + 3 * (f + 1);
  const c = r.choose('office.colour', {}, [1, 2, 3, 4]);
  const B = (s: string) => OF(`Building_${c}_${s}`);
  const p = new Parts();
  const bays: [number, string][] = [[0, 'Left'], ...Array.from({ length: k }, (_, i) => [2 + 3 * i, 'Middle_Modular'] as [number, string]), [w - 2, 'Right']];
  // roof: one middle may carry the stair housing
  const stairs = r.choose('office.roofStairs', {}, { p: 0.5 }) ? r.int(0, k - 1) : -1;
  for (const [x, s] of bays) p.add(OF(s === 'Middle_Modular' ? (stairs === (x - 2) / 3 ? 'Roof_Stairs' : 'Roof_Middle_Modular') : `Roof_${s}`), x * T, 0, 'roof');
  const floors = f + 1;
  for (let i = 0; i < floors; i += 2) {
    const y = 5 + 3 * Math.min(i, floors - 2);
    for (const [x, s] of bays) p.add(B(s), x * T, y * T, 'mid');
  }
  // window style per upper floor: as drawn, ribbon windows on the middle bays, or one of the window sets
  for (let i = 0; i < f; i++) {
    const y = (5 + 3 * i + 1) * T;
    const style = r.choose('office.windows', {}, { weights: [['base', 3], ['ribbon', 2], ['set', 2], ['shutter', 1]] as const });
    if (style === 'base') continue;
    for (const [x, s] of bays) {
      const mid = s === 'Middle_Modular';
      if (style === 'ribbon') { if (mid) p.add(B('Window_Modular'), x * T, y); continue; }
      if (style === 'set') { const n = r.choose('office.windowSet', { i }, [1, 2, 3, 4]); p.add(OF(`Window_${n}_${mid ? 'Middle' : s}_Modular`), x * T, y); continue; }
      p.add(OF(`Window_With_Shutter_${mid ? 4 : 3}_Modular`), x * T, y);
    }
  }
  // ground floor: the entrance in one middle bay (colourway 3 has none: it shares 2's), shutters at the ends sometimes
  const gy = (h - 3) * T;
  const door = r.int(0, k - 1);
  const entrance = hasSprite(B('Middle_Modular_2')) ? B('Middle_Modular_2') : OF('Building_2_Middle_Modular_2');
  p.add(entrance, (2 + 3 * door) * T, gy, 'ground');
  for (const [x, s] of bays) if (s !== 'Middle_Modular' && r.choose('office.shutter', { side: s }, { p: 0.4 })) p.add(B(`${s}_2`), x * T, gy, 'ground');
  // company sign over the ground floor, roof props
  if (w >= 10 && r.choose('office.sign', {}, { p: 0.7 })) p.add(OF(r.choose('office.signModel', {}, ['Building_Sign_1', 'Building_Sign_2'])), Math.floor((w - 7) / 2) * T, gy);
  const props = r.count('office.roofProps', {}, 0, Math.min(3, k + 1));
  for (let i = 0; i < props; i++) p.add(OF(r.choose('office.roofProp', {}, ROOF_PROPS)), (1 + (props > 1 ? i * (w - 4) / (props - 1) : r.int(0, w - 4))) * T, 1.5 * T);
  return plan(w, h, 5, p, [2 + 3 * door + 1.5], 'office', `Office_kit/${w}w${f + 1}f`);
}

// ---------------------------------------------------------------------------------------------- hotel

const HO = (s: string) => `12_Hotel_and_Hospital/${s}`;

/** hotel (Hotel_1 grammar), 17 wide: cap 2 + roof rows 1 x e + top 7 + floor 4 x n + ground 9: h = 18 + e + 4n */
export function hotel(n: number, e: number): BuildingPlan {
  const h = 18 + e + 4 * n;
  const p = new Parts();
  p.add(HO('Hotel_Modular_5'), 0, 0, 'roof');
  for (let i = 0; i < e; i++) p.add(HO('Hotel_Modular_4'), 0, (2 + i) * T, 'roof');
  p.add(HO('Hotel_Modular_3'), 0, (2 + e) * T, 'roof');
  for (let i = 0; i < n; i++) p.add(HO('Hotel_Modular_2'), 0, (9 + e + 4 * i) * T, 'mid');
  p.add(HO('Hotel_Modular_1'), 0, (9 + e + 4 * n) * T, 'ground');
  // the name on the roof, as in Hotel_1 (the vertical Hotel_Signboard_2 covers a window column wherever it hangs)
  p.add(HO('Hotel_Signboard_1'), 4 * T, 0);
  return plan(17, h, 5 + e, p, [8.5], 'hotel', `Hotel_kit/${n + 2}f`);
}
