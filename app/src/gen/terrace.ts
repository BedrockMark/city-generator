// exp-04 (adopted 2026-11-06, NOTE D54): buildings put together from several parts, and neighbours that touch switch to their linked (seamless) state.
// The asset packs draw both states: every 7-wide roof / middle floor / ground floor of 5_Floor_Modular_Building has
// 1-wide "_Modular" strips that replace its left / right edge column (pilaster, parapet side), so two pieces side by side
// read as one facade (reference shop_on_street: two Middle_Floor_5 with Middle_Floor_Modular_10 / _9 over the
// touching columns, one merged flat roof). Table: data/links.json (tools/export_links.py).
// Composite buildings (proposed by the packer on the stream exp/exp-04, see pack.ts):
//   - terrace: 2-3 floor-modular sections in one colourway, own storefronts, heights may step by one floor;
//   - condo bays: Condo_1 / Condo_2 (4_Generic_Building) left bay with the door + 2-wide middle bays + right cap;
//   - terraced row: 2-3 Terraced_House_Modular units (24_Additional_Houses), the 10-wide repeat unit of a row.
// linkBuildings is deterministic (no random numbers): it only swaps parts of buildings that already stand side by side.
import { Rng } from './rng';
import { spr, hasSprite } from './assets';
import { modularStack, expId, type BuildingPlan } from './buildings';
import type { BlockPlan, PlacedBuilding } from './block';
import { TILE as T } from './types';
import linksRaw from './data/links.json';

export const EXP04 = 'exp-04';
const LINKS = linksRaw as unknown as Record<string, { L: string | null; R: string | null }>;
const MOD = '5_Floor_Modular_Building/';

// ---------------------------------------------------------------------------------------------- composites

/** one more section of a floor-modular terrace next to `prev` (same colourway; the same roof when the height matches,
 *  so the roofs can merge); null when the colourway is not in the label */
export function terraceSection(r: Rng, prev: BuildingPlan, opts: { floors: number; avoidFamily: string; front?: BuildingPlan['front'] }): BuildingPlan | null {
  const m = prev.label.split('/');
  if (m.length !== 3) return null;
  const roof = prev.parts.find(p => p.role === 'roof')?.key;
  const same = opts.floors === +m[2][0];
  const useRoof = same && roof && r.choose('terrace.sameRoof', {}, { p: 0.8 }) ? roof : undefined;
  // Music_Store pieces are filed under the wrong colourway in modular.json (a red storefront in a "blue" stack) and have
  // no seam strips: a terrace section never takes one
  for (let t = 0; t < 4; t++) {
    const mk = r.mark();
    const b = modularStack(r, { colour: m[1] as 'red' | 'blue' | 'grey', floors: opts.floors, avoidFamily: opts.avoidFamily, front: opts.front, roof: useRoof, id: 'e' });
    if (!b.label.startsWith('Music_Store')) return { ...b, id: expId() };
    r.reject(mk, 'terrace:music');
  }
  return null;
}

/** Condo_1 (yellow) / Condo_2 (grey): [left bay with door, 3] + k x [middle bay, 2] + [right cap, 1]; w = 4 + 2k.
 *  Sprite heights: variants 1-5 are 12 rows, 6-10 the same bays one floor lower (10 rows). */
export function condoBays(r: Rng, w: number, maxH: number): BuildingPlan | null {
  if (w < 4 || w % 2) return null;
  const tall = maxH >= 12 && r.choose('condoBays.tall', {}, { p: 0.6 });
  if (!tall && maxH < 10) return null;
  const set = r.choose('condoBays.colour', {}, ['Condo_1', 'Condo_2'] as const);
  const k = (n: number) => `4_Generic_Building/${set}_${n + (tall ? 0 : 5)}`;
  if (![1, 2, 3, 4, 5].every(n => hasSprite(k(n)))) return null;
  const h = tall ? 12 : 10;
  const parts: BuildingPlan['parts'] = [];
  let x = 0;
  const add = (key: string) => { parts.push({ key, dx: x, dy: (h * T) - spr(key).h, sub: parts.length, role: 'whole' }); x += spr(key).w; };
  add(k(r.choose('condoBays.left', {}, [1, 2])));
  for (let i = 0; i < (w - 4) / 2; i++) add(k(3));
  add(k(r.choose('condoBays.cap', {}, [4, 5])));
  // the door sits in the left bay (measured: centre 25 px); the roof deck is the top 5 rows
  return { id: expId(), w, h, foot: 5, parts, doors: [25], front: 'condo', tall: tall, label: `${set}_bays/${w}w` };
}

/** door centres (cells) of Terraced_House_Modular_1..6 (measured on the sprites) */
const TERRACE_DOORS = [2.75, 6.9, 7.5, 2.75, 6.9, 7.5];

/** n Terraced_House_Modular units side by side (10 cells each, bottom-aligned); the rightmost one shows its side wall */
export function terracedRow(r: Rng, n: number, maxH: number): BuildingPlan | null {
  const key = (v: number) => `24_Additional_Houses/24_Terraced_House_Modular_${v}`;
  const pool = [1, 2, 3, 4, 5, 6].filter(v => hasSprite(key(v)) && spr(key(v)).h / T <= maxH);
  if (pool.length < 2) return null;
  const vs: number[] = [];
  for (let i = 0; i < n; i++) vs.push(r.choose('terracedRow.unit', { i }, pool.filter(v => v !== vs[i - 1])));
  const h = Math.max(...vs.map(v => spr(key(v)).h / T));
  const parts: BuildingPlan['parts'] = vs.map((v, i) => ({ key: key(v), dx: i * 10 * T, dy: h * T - spr(key(v)).h, sub: i, role: 'whole' as const }));
  return { id: expId(), w: 10 * n, h, foot: Math.max(3, Math.min(h - 2, Math.round(h * 0.5))), parts, doors: vs.map((v, i) => (i * 10 + TERRACE_DOORS[v - 1]) * T),
    front: 'house', tall: h >= 14, label: `Terraced_row/${n}x` };
}

// ---------------------------------------------------------------------------------------------- linking

type Part = BuildingPlan['parts'][number];
interface Stack { colour: string; floors: number; roof?: Part; mids: Part[]; ground?: Part }

/** layers of a floor-modular stack, middle floors bottom first; null for anything else */
function stackOf(b: BuildingPlan): Stack | null {
  const m = b.label.split('/');
  if (m.length !== 3 || !b.parts.every(p => p.key.startsWith(MOD))) return null;
  return { colour: m[1], floors: +m[2][0], roof: b.parts.find(p => p.role === 'roof'), mids: b.parts.filter(p => p.role === 'mid').reverse(), ground: b.parts.find(p => p.role === 'ground') };
}

/** roofs that continue into each other: the same flat deck, or the same tiles (with / without firewall pillars) */
const ROOF_STUFF: Record<number, string> = { 1: 'teal deck', 3: 'gold deck', 5: 'beige deck', 7: 'framed deck', 10: 'grey deck', 2: 'red tiles', 8: 'red tiles', 4: 'dark tiles', 9: 'dark tiles', 6: 'green tiles', 11: 'green tiles' };
const roofStuff = (key: string) => ROOF_STUFF[+key.split('_').pop()!];

/** strip over the `side` edge column of part p (bottom-aligned with it) */
function strip(p: Part, side: 'L' | 'R', w: number): Part | null {
  const key = LINKS[p.key]?.[side];
  if (!key) return null;
  return { key, dx: p.dx + (side === 'L' ? 0 : w * T - T), dy: p.dy + spr(p.key).h - spr(key).h, sub: 0, role: 'link' };
}

/** which layers of A (left) and B (right) link, with the strips to lay over A's right and B's left edge */
function pairLinks(a: BuildingPlan, b: BuildingPlan): { what: string[]; sa: [Part, Part][]; sb: [Part, Part][] } | null {
  const A = stackOf(a), B = stackOf(b);
  if (!A || !B) return null;
  const what: string[] = [], sa: [Part, Part][] = [], sb: [Part, Part][] = [];
  // both strips or none: one seam half gone looks worse than the seam
  const both = (pa: Part, pb: Part, name: string) => {
    const x = strip(pa, 'R', a.w), y = strip(pb, 'L', b.w);
    if (!x || !y) return;
    sa.push([pa, x]); sb.push([pb, y]); what.push(name);
  };
  if (A.colour === B.colour) {
    if (A.ground && B.ground) both(A.ground, B.ground, '底层');
    for (let i = 0; i < Math.min(A.floors, B.floors); i++) both(A.mids[i], B.mids[i], `第 ${i + 2} 层`);
  }
  // roofs at the same height (same number of floors) of the same stuff, over facades of one colourway (one roof over
  // two unlike facades reads as a mistake); a firewall pillar stays and takes no strip
  if (A.colour === B.colour && A.floors === B.floors && A.roof && B.roof && roofStuff(A.roof.key) && roofStuff(A.roof.key) === roofStuff(B.roof.key)) {
    const x = strip(A.roof, 'R', a.w), y = strip(B.roof, 'L', b.w);
    const flat = roofStuff(A.roof.key).endsWith('deck');
    if (flat ? x && y : x || y) {
      if (x) sa.push([A.roof, x]);
      if (y) sb.push([B.roof, y]);
      what.push(x && y ? '屋顶' : '屋顶（留一根防火墙柱）');
    }
  }
  return what.length ? { what, sa, sb } : null;
}

/** insert each strip right after the part it covers (so a ground-floor sign drawn later still overlaps the floor above) */
function insertStrips(b: BuildingPlan, add: [Part, Part][]) {
  if (!add.length) return;
  const out: Part[] = [];
  for (const p of b.parts) { out.push(p); for (const [q, s] of add) if (q === p) out.push(s); }
  out.forEach((p, i) => { p.sub = i; });
  b.parts = out;
}

/** every two floor-modular stacks standing side by side (touching, same bottom row) switch the touching layers to their
 *  linked state. Returns the number of links made. */
export function linkBuildings(plans: BlockPlan[]): number {
  let n = 0;
  for (const plan of plans) {
    const bs = plan.buildings;
    const bottom = (p: PlacedBuilding) => p.cy + p.plan.h;
    for (const pa of bs) {
      const pb = bs.find(q => q !== pa && q.cx === pa.cx + pa.plan.w && bottom(q) === bottom(pa));
      if (!pb) continue;
      const L = pairLinks(pa.plan, pb.plan);
      if (!L) continue;
      insertStrips(pa.plan, L.sa); insertStrips(pb.plan, L.sb);
      for (const [p, other, side] of [[pa, pb, '右'], [pb, pa, '左']] as const) {
        p.why += `；链接：${side}边紧挨 ${other.plan.id}（${other.plan.label}），${L.what.join('、')}换成无墙缝的链接条`;
      }
      n++;
    }
  }
  return n;
}
