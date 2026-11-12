// World-layer block statistics. Usage: npx tsx scripts/blockstats.ts <cmd> [--seeds a,b,...]
//   zone: zoneValue at arterial-cell centres (seeds 1..30, cells -3..3 each way) and the three-way split
//   districts: special districts by zone (city regression seeds city_seeds.json, cells -2..2 each way): blocks per cell
//     (islands not counted), the share of blocks that are districts, drawn / placed, and placed / drawn by kind
//   find: the first example of each district kind, centre plaza and garden in the city regression seeds x [-2,2]^2, and per
//     zone and t band the most typical cell centre (world cell) to look at
//   fronts [--seeds ...]: per zone over blocks of cells [-1,1]^2 (generateBlock): main-block buildings, shop-front share,
//     single-sprite share, kit (office / hotel) share, share of blocks with a street plaza
import { readFileSync } from 'node:fs';
import { cellRect } from '../src/world/arterials';
import { zoneValue } from '../src/world/zone';
import { cellBlocks, cellDistrict, cellLotRange } from '../src/world/blocks';
import { ZONE_THRESHOLDS, DISTRICT_CHANCE } from '../src/world/config';
import { generateBlock } from '../src/world/window';
import { DISTRICTS } from '../src/gen/district';
import type { ZoneKind } from '../src/world/types';

const args = process.argv.slice(2);
const cmd = args[0];
const si = args.indexOf('--seeds');
const seeds = si >= 0 ? args[si + 1].split(',') : Array.from({ length: 30 }, (_, k) => String(k + 1));
const range = [-3, -2, -1, 0, 1, 2, 3];

function zone(): void {
  const vals: number[] = [];
  for (const s of seeds) for (const i of range) for (const j of range) {
    const r = cellRect(s, i, j);
    vals.push(zoneValue(s, Math.floor((r.x0 + r.x1) / 2), Math.floor((r.y0 + r.y1) / 2)));
  }
  vals.sort((a, b) => a - b);
  const n = vals.length, q = (p: number) => vals[Math.floor(p * (n - 1))].toFixed(2);
  const a = vals.filter(v => v >= ZONE_THRESHOLDS.downtown).length, c = vals.filter(v => v < ZONE_THRESHOLDS.residential).length;
  console.log(`zone value at ${n} cell centres: p5 ${q(0.05)} p50 ${q(0.5)} p95 ${q(0.95)}; downtown ${a} mixed ${n - a - c} residential ${c}`);
}

function districts(): void {
  const ss: string[] = si >= 0 ? seeds : JSON.parse(readFileSync(new URL('./city_seeds.json', import.meta.url), 'utf8'));
  const st = new Map<ZoneKind, { cells: number; blocks: number; districts: number; drawn: number; placed: number; kinds: Map<string, [number, number]> }>();
  for (const s of ss) for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
    const { zone } = cellLotRange(s, i, j);
    let z = st.get(zone);
    if (!z) st.set(zone, z = { cells: 0, blocks: 0, districts: 0, drawn: 0, placed: 0, kinds: new Map() });
    const bs = cellBlocks(s, i, j).filter(b => b.shape !== 'island');
    const kind = cellDistrict(s, i, j, zone), placed = bs.some(b => b.district);
    z.cells++;
    z.blocks += bs.length;
    if (kind) {
      const k = z.kinds.get(kind) ?? [0, 0];
      k[1]++;
      z.drawn++;
      if (placed) { k[0]++; z.placed++; z.districts++; }
      z.kinds.set(kind, k);
    }
  }
  for (const zone of ['downtown', 'mixed', 'residential'] as const) {
    const z = st.get(zone);
    if (!z) { console.log(`${zone}: 0 cells`); continue; }
    const kinds = [...z.kinds].map(([k, [p, d]]) => `${k} ${p}/${d}`).join(', ');
    console.log(`${zone}: ${z.cells} cells (chance ${DISTRICT_CHANCE[zone]}), blocks/cell ${(z.blocks / z.cells).toFixed(2)}, `
      + `districts ${z.districts}/${z.blocks} (${(z.districts / z.blocks).toFixed(3)}), drawn ${z.drawn} placed ${z.placed}`
      + `${z.drawn ? ` (s ${(z.placed / z.drawn).toFixed(2)})` : ''}${kinds ? `; ${kinds}` : ''}`);
  }
}

const citySeeds = (): string[] => (si >= 0 ? seeds : JSON.parse(readFileSync(new URL('./city_seeds.json', import.meta.url), 'utf8')));
const centreOf = (r: { x0: number; y0: number; x1: number; y1: number }) => `(${Math.floor((r.x0 + r.x1) / 2)}, ${Math.floor((r.y0 + r.y1) / 2)})`;

function find(): void {
  const first = new Map<string, string>();
  const band = new Map<string, { t: number; at: string; seed: string }>();
  const order = (t: number) => t < 0.25 ? 0 : t < 0.5 ? 1 : t < 0.75 ? 2 : 3;
  const better = (zone: string, t: number, old: number) => zone === 'downtown' ? t > old : zone === 'residential' ? t < old : Math.abs(t - 0.5) < Math.abs(old - 0.5);
  for (const s of citySeeds()) for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
    const { zone, t } = cellLotRange(s, i, j), r = cellRect(s, i, j);
    const k = `${zone} t${order(t)}`, o = band.get(k);
    if (!o || better(zone, t, o.t)) band.set(k, { t, at: centreOf(r), seed: s });
    for (const b of cellBlocks(s, i, j)) {
      if (b.shape === 'island') continue;
      const key = b.district ?? b.centre;
      if (!key || first.has(key)) continue;
      const lw = Math.max(...b.foot.map(f => f.x1)) - Math.min(...b.foot.map(f => f.x0)) - 2 * b.sw;
      const lh = Math.max(...b.foot.map(f => f.y1)) - Math.min(...b.foot.map(f => f.y0)) - 2 * b.sw;
      first.set(key, `seed ${s} ${b.id} ${b.zone} 中心 ${centreOf({ x0: Math.min(...b.foot.map(f => f.x0)), y0: Math.min(...b.foot.map(f => f.y0)), x1: Math.max(...b.foot.map(f => f.x1)), y1: Math.max(...b.foot.map(f => f.y1)) })} 地块 ${lw}×${lh}`);
    }
  }
  for (const k of [...Object.keys(DISTRICTS), 'plaza', 'garden']) console.log(`${k}: ${first.get(k) ?? 'none'}`);
  for (const z of ['downtown', 'mixed', 'residential']) for (let q = 0; q < 4; q++) {
    const o = band.get(`${z} t${q}`);
    console.log(`${z} t band ${q}: ${o ? `seed ${o.seed} 格中心 ${o.at} t ${o.t.toFixed(2)}` : 'none'}`);
  }
}

function fronts(): void {
  const ss = si >= 0 ? seeds : ['1', '2', '3', '4', '5'];
  interface A { blocks: number; main: number; shop: number; single: number; kit: number; plaza: number }
  const st = new Map<string, A>();
  for (const s of ss) for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const b of cellBlocks(s, i, j)) {
    const { scene } = generateBlock(s, b.id);
    const a = st.get(b.zone) ?? { blocks: 0, main: 0, shop: 0, single: 0, kit: 0, plaza: 0 };
    st.set(b.zone, a);
    a.blocks++;
    if (scene.zones?.some(z => z.kind === 'plaza' && z.layer === 'block')) a.plaza++;
    const whole = new Set((scene.objects).filter(o => o.gid && o.reason?.includes('整体精灵')).map(o => o.gid));
    for (const bd of scene.buildings ?? []) {
      if (bd.block !== 'main' || bd.front === 'landmark') continue;
      a.main++;
      if (bd.front !== 'condo' && bd.front !== 'house') a.shop++;
      if (whole.has(bd.gid)) a.single++;
      if (bd.front === 'office' || bd.front === 'hotel') a.kit++;
    }
  }
  const pc = (n: number, d: number) => `${d ? (100 * n / d).toFixed(0) : '-'}%`;
  for (const z of ['downtown', 'mixed', 'residential']) {
    const a = st.get(z);
    if (!a) { console.log(`${z}: 0 blocks`); continue; }
    console.log(`${z}: ${a.blocks} blocks, ${a.main} main-block buildings, shop fronts ${pc(a.shop, a.main)}, single sprites ${pc(a.single, a.main)}, kit ${pc(a.kit, a.main)}, blocks with a street plaza ${pc(a.plaza, a.blocks)}`);
  }
}

if (cmd === 'zone') zone();
else if (cmd === 'find') find();
else if (cmd === 'fronts') fronts();
else if (cmd === 'districts') districts();
else { console.error('usage: blockstats.ts zone|districts|find|fronts [--seeds a,b,...]'); process.exit(1); }
