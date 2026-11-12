// World regression (v0.8.1): per seed, the 5 x 5 chunks cx, cy in [-2, 2] (world cells [-128, 192)^2) are built with
// getChunk and checked, then a report over all seeds is written.
//   npx tsx scripts/cityregress.ts <outDir> [--seeds a,b,...] [--jobs n] [--locality k] [--base <regress snapshot dir>] [--prev <old cityregress dir>]
// Writes <outDir>/<seed>.json (statistics and check results of one seed) and <outDir>/report.md; exit code 1 when a
// seam / locality / road connectivity check fails.
//   seam / unique: the chunks' ground side by side equals assembleRegion(whole area).ground cell by cell; object ids
//                  are unique and the id set (with coordinates) equals assembleRegion's
//   locality:      the first k seeds are built again (caches cleared, reverse chunk order); every chunk JSON is equal
//   roads:         every 4-connected road component of the area touches its border; every block with a lot cell in the
//                  area has a sidewalk cell that has a road cell as 4-neighbour
//   ranges:        (v0.8.2) every non-district, non-island block with a lot in the area has a lot within cellLotRange
//   centreReach:   (v0.8.2) the centre of every generated block with b.centre is reachable from the street (centreReachable)
// --prev <dir> adds a comparison table against an older cityregress output directory.
// --jobs n splits the seeds over n child processes (as regress.ts snapshot-par); a child is `--shard k/n --child`.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getChunk, chunkRect } from '../src/world/chunk';
import { assembleRegion, blocksIn } from '../src/world/region';
import { generateBlock, _clearWindowCache } from '../src/world/window';
import { blockById, cellLotRange, _clearBlockCache } from '../src/world/blocks';
import { blockRaster, classRaster, ownerRaster } from '../src/world/cells';
import { CHUNK, CENTRE_MIN } from '../src/world/config';
import { centreReachable } from '../src/gen/centre';
import { TILE } from '../src/gen/types';
import type { Rect } from '../src/world/types';

const args = process.argv.slice(2);
const value = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const valued = new Set(['--seeds', '--jobs', '--locality', '--base', '--shard', '--prev']);
const [outDir] = args.filter((x, i) => !x.startsWith('--') && !valued.has(args[i - 1]));
const here = dirname(fileURLToPath(import.meta.url));
const ALL: string[] = JSON.parse(readFileSync(join(here, 'city_seeds.json'), 'utf8'));
const seeds = value('--seeds') ? value('--seeds')!.split(',').filter(Boolean) : ALL;
const jobs = Math.max(1, Number(value('--jobs') ?? 1));
const locality = Number(value('--locality') ?? 3);
const base = value('--base');
const prev = value('--prev');
const child = args.includes('--child');
if (!outDir || !Number.isInteger(jobs) || !Number.isInteger(locality)) {
  console.error('usage: cityregress.ts <outDir> [--seeds a,b,...] [--jobs n] [--locality k] [--base <regress snapshot dir>] [--prev <old cityregress dir>]');
  process.exit(2);
}

const T0 = Date.now();
const CH = [-2, -1, 0, 1, 2];
const R: Rect = { x0: CH[0] * CHUNK, y0: CH[0] * CHUNK, x1: (CH[4] + 1) * CHUNK, y1: (CH[4] + 1) * CHUNK };
const W = R.x1 - R.x0;
const clear = () => { _clearWindowCache(); _clearBlockCache(); };
const sorted = (v: number[]) => [...v].sort((a, b) => a - b);

interface Check { ok: boolean; detail: string }
interface SeedStat {
  seed: string; blocks: number; generated: number; objects: number; ms: { total: number; blockAvg: number; blockMax: number; chunkAvg: number; chunkMax: number };
  lotW: number[]; lotH: number[]; zones: Record<string, number>; jog: number;
  violations: Record<string, number>; violationsTotal: number;
  seam: Check; unique: Check; locality: Check | null; roads: Check; sidewalks: Check;
  ranges: Check; centreReach: Check;
  byT: { t: number; w: number; h: number }[];
  districts: Record<string, number>;
  centres: { plaza: number; garden: number; carved: number };
  big: { blocks: number; violations: number };
}

function runSeed(seed: string, idx: number): SeedStat {
  clear();
  const t0 = performance.now();
  // block generation timed one by one (the chunks then hit the cache), chunk assembly timed separately
  const ids = blocksIn(seed, R), bt: number[] = [];
  for (const id of ids) { const t = performance.now(); generateBlock(seed, id); bt.push(performance.now() - t); }
  const chunks = new Map<string, string>(), ct: number[] = [];
  const ground = Array.from({ length: 2 }, () => Array.from({ length: W }, () => Array<unknown>(W).fill(undefined)));
  const objIds: string[] = [], got: string[] = [];
  let layers = 2, objects = 0;
  const key = (cx: number, cy: number) => `${cx},${cy}`;
  for (const cy of CH) for (const cx of CH) {
    const t = performance.now();
    const c = getChunk(seed, cx, cy);
    ct.push(performance.now() - t);
    chunks.set(key(cx, cy), JSON.stringify(c));
    layers = Math.max(layers, c.ground.length);
    while (ground.length < c.ground.length) ground.push(Array.from({ length: W }, () => Array<unknown>(W).fill(undefined)));
    c.ground.forEach((layer, l) => layer.forEach((row, y) => row.forEach((v, x) => { ground[l][(cy - CH[0]) * CHUNK + y][(cx - CH[0]) * CHUNK + x] = v; })));
    for (const o of c.objects) { objIds.push(o.id!); got.push(`${o.id}@${o.x},${o.y},${o.foot}`); }
    objects += c.objects.length;
  }

  // seam / unique against the whole-area assembly (chunk px -> region px: shift by the area origin, as chunk.test.ts)
  const s = assembleRegion(seed, R), d = R.x0 * TILE;
  let diff = 0, first = '';
  const nl = Math.max(layers, s.ground.length);
  for (let l = 0; l < nl; l++) for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const a = JSON.stringify(ground[l]?.[y]?.[x] ?? null), b = JSON.stringify(s.ground[l]?.[y]?.[x] ?? null);
    if (a !== b) { diff++; if (!first) first = `layer ${l} cell ${x + R.x0},${y + R.y0}`; }
  }
  const seam: Check = { ok: diff === 0 && layers === s.ground.length,
    detail: diff ? `${diff} differing cells (first: ${first})` : layers !== s.ground.length ? `layer count ${layers} vs ${s.ground.length}` : `${W}x${W} cells, ${layers} layers equal` };
  const want = s.objects.map(o => `${o.id}@${o.x + d},${o.y + d},${o.foot + d}`).sort(), gs = [...got].sort();
  const dup = objIds.length - new Set(objIds).size;
  const missing = want.filter((w, i) => w !== gs[i]).length;
  const unique: Check = { ok: dup === 0 && gs.length === want.length && missing === 0,
    detail: `${objects} objects, ${dup} duplicate ids, ${gs.length === want.length ? 'count equals assembleRegion' : `count ${gs.length} vs ${want.length}`}${missing ? `, ${missing} mismatches` : ''}` };

  // locality: caches cleared, reverse order, same chunk JSON
  let loc: Check | null = null;
  if (idx < locality) {
    clear();
    let bad = 0, firstBad = '';
    for (const cy of [...CH].reverse()) for (const cx of [...CH].reverse()) {
      if (JSON.stringify(getChunk(seed, cx, cy)) !== chunks.get(key(cx, cy))) { bad++; if (!firstBad) firstBad = key(cx, cy); }
    }
    loc = { ok: bad === 0, detail: bad ? `${bad} chunks differ (first ${firstBad})` : '25 chunks equal after cache clear, reverse order' };
  }

  // road connectivity on the area; the block raster is read one cell wider so edge sidewalks see their road neighbours
  const P: Rect = { x0: R.x0 - 1, y0: R.y0 - 1, x1: R.x1 + 1, y1: R.y1 + 1 }, PW = W + 2;
  const cls = classRaster(seed, P), blk = blockRaster(seed, P);
  const seen = Array.from({ length: PW }, () => new Uint8Array(PW));
  let comps = 0, floating = 0;
  const inArea = (x: number, y: number) => x >= 1 && y >= 1 && x < PW - 1 && y < PW - 1;
  for (let y0 = 1; y0 < PW - 1; y0++) for (let x0 = 1; x0 < PW - 1; x0++) {
    if (cls[y0][x0] !== 'road' || seen[y0][x0]) continue;
    comps++;
    let edge = false;
    const st = [[x0, y0]]; seen[y0][x0] = 1;
    while (st.length) {
      const [x, y] = st.pop()!;
      if (x === 1 || y === 1 || x === PW - 2 || y === PW - 2) edge = true;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]])
        if (inArea(nx, ny) && cls[ny][nx] === 'road' && !seen[ny][nx]) { seen[ny][nx] = 1; st.push([nx, ny]); }
    }
    if (!edge) floating++;
  }
  const roads: Check = { ok: floating === 0, detail: `${comps} road components, ${floating} not touching the border` };
  const lotIds = new Set<string>(), hasRoad = new Set<string>();
  for (let y = 1; y < PW - 1; y++) for (let x = 1; x < PW - 1; x++) {
    const b = blk[y][x];
    if (!b) continue;
    if (cls[y][x] === 'lot') lotIds.add(b);
    else if (cls[y][x] === 'walk' && [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]].some(([nx, ny]) => cls[ny][nx] === 'road')) hasRoad.add(b);
  }
  const cut = [...lotIds].filter(b => !hasRoad.has(b));
  const sidewalks: Check = { ok: cut.length === 0, detail: `${lotIds.size} blocks with lots, ${cut.length} without a sidewalk cell next to a road${cut.length ? ` (${cut.slice(0, 3).join(' ')})` : ''}` };

  // distribution and violations (as cityshot.ts) over the blocks with a lot cell in the area
  const blocks = [...lotIds].sort().map(id => blockById(seed, id));
  const lotW = sorted(blocks.map(b => Math.max(...b.foot.map(f => f.x1)) - Math.min(...b.foot.map(f => f.x0)) - 2 * b.sw));
  const lotH = sorted(blocks.map(b => Math.max(...b.foot.map(f => f.y1)) - Math.min(...b.foot.map(f => f.y0)) - 2 * b.sw));
  const zones: Record<string, number> = {};
  for (const b of blocks) zones[b.zone] = (zones[b.zone] ?? 0) + 1;
  const lotSize = (b: (typeof blocks)[number]) => ({
    w: Math.max(...b.foot.map(f => f.x1)) - Math.min(...b.foot.map(f => f.x0)) - 2 * b.sw,
    h: Math.max(...b.foot.map(f => f.y1)) - Math.min(...b.foot.map(f => f.y0)) - 2 * b.sw });
  const owner = ownerRaster(seed, R), viol: Record<string, number> = {}, violBy = new Map<string, number>();
  const dist: Record<string, number> = {}, centres = { plaza: 0, garden: 0, carved: 0 };
  const badReach: string[] = [];
  for (const id of ids) {
    const { scene, ox, oy } = generateBlock(seed, id);
    for (const v of scene.audit?.violations ?? []) {
      const x = ox - R.x0 + Math.floor((v.rect.x0 + v.rect.x1) / 2 / TILE), y = oy - R.y0 + Math.floor((v.rect.y0 + v.rect.y1) / 2 / TILE);
      if (x >= 0 && y >= 0 && x < W && y < W && owner[y][x] === id) { viol[v.c] = (viol[v.c] ?? 0) + 1; violBy.set(id, (violBy.get(id) ?? 0) + 1); }
    }
    const b = blockById(seed, id);
    if (b.centre) {
      centres[b.centre]++;
      if (scene.zones?.some(z => z.kind === 'centre')) centres.carved++;
      if (!centreReachable(scene)) badReach.push(id);
    }
  }
  // district blocks (kind@zone) among the blocks with a lot in the area
  for (const b of blocks) if (b.district) { const k = `${b.district}@${b.zone}`; dist[k] = (dist[k] ?? 0) + 1; }
  const plain = blocks.filter(b => !b.district && b.shape !== 'island');
  const byT = plain.map(b => ({ t: cellLotRange(seed, ...b.cell).t, ...lotSize(b) }));
  const outOfRange = plain.filter(b => {
    const r = cellLotRange(seed, ...b.cell), z = lotSize(b);
    return z.w < r.lotW[0] || z.w > r.lotW[1] || z.h < r.lotH[0] || z.h > r.lotH[1];
  });
  const ranges: Check = { ok: outOfRange.length === 0, detail: `${plain.length} blocks, ${outOfRange.length} lot outside cellLotRange${outOfRange.length ? ` (${outOfRange.slice(0, 3).map(b => { const z = lotSize(b), r = cellLotRange(seed, ...b.cell); return `${b.id} ${z.w}x${z.h} vs ${r.lotW}/${r.lotH}`; }).join('; ')})` : ''}` };
  const nCentre = centres.plaza + centres.garden;
  const centreReach: Check = { ok: badReach.length === 0, detail: `${nCentre} centres, ${badReach.length} not reachable from the street${badReach.length ? ` (${badReach.slice(0, 3).join(' ')})` : ''}` };
  const bigB = blocks.filter(b => { const z = lotSize(b); return z.w >= CENTRE_MIN.w && z.h >= CENTRE_MIN.h; });
  const big = { blocks: bigB.length, violations: bigB.reduce((p, b) => p + (violBy.get(b.id) ?? 0), 0) };
  const sum = (v: number[]) => v.reduce((p, q) => p + q, 0);
  return {
    seed, blocks: blocks.length, generated: ids.length, objects,
    ms: { total: performance.now() - t0, blockAvg: sum(bt) / bt.length, blockMax: Math.max(...bt), chunkAvg: sum(ct) / ct.length, chunkMax: Math.max(...ct) },
    lotW, lotH, zones, jog: blocks.filter(b => b.shape === 'jog').length,
    violations: viol, violationsTotal: sum(Object.values(viol)),
    seam, unique, locality: loc, roads, sidewalks, ranges, centreReach, byT, districts: dist, centres, big,
  };
}

if (child || jobs === 1) {
  // run (a shard of) the seeds in this process
  mkdirSync(outDir, { recursive: true });
  const sh = value('--shard'), [k, n] = sh ? sh.split('/').map(Number) : [0, 1];
  seeds.forEach((s, i) => {
    if (i % n !== k) return;
    const st = runSeed(s, i);
    writeFileSync(join(outDir, `${s}.json`), JSON.stringify(st));
    if (child) return;
    console.log(`seed ${s}: ${(st.ms.total / 1000).toFixed(1)} s`);
  });
  if (!child) finish(T0);
} else {
  mkdirSync(outDir, { recursive: true });
  const tsx = createRequire(import.meta.url).resolve('tsx/cli');
  const rest = args.filter((x, i) => x !== '--jobs' && args[i - 1] !== '--jobs');
  const t0 = Date.now(), n = Math.min(jobs, seeds.length);
  Promise.all(Array.from({ length: n }, (_, k) => new Promise<number>(res => {
    const p = spawn(process.execPath, [tsx, join(here, 'cityregress.ts'), ...rest.filter(x => x !== '--child'), '--child', '--shard', `${k}/${n}`], { stdio: ['ignore', 'ignore', 'inherit'] });
    p.on('exit', code => res(code ?? 1));
  }))).then(codes => {
    if (codes.some(c => c)) { console.error(`cityregress: shard exit codes ${codes.join(' ')}`); process.exit(1); }
    finish(t0);
  });
}

function finish(t0: number): void {
  const stats = seeds.map(s => JSON.parse(readFileSync(join(outDir, `${s}.json`), 'utf8')) as SeedStat);
  const L: string[] = [];
  const mark = (ok: boolean) => (ok ? '通过' : '不通过');
  const fmt = (v: number[]) => (v.length ? `${v[0]} / ${v[Math.floor(v.length / 2)]} / ${v[v.length - 1]}` : '-');
  let failed = false;
  L.push(`# 世界回归 ${new Date().toISOString()}`, '', `种子 ${seeds.length} 个（${seeds.join(' ')}），每个区块 cx, cy in [-2, 2]（世界格 [${R.x0}, ${R.x1})^2），局部性检查前 ${Math.min(locality, seeds.length)} 个种子。`, '');
  L.push('## 检查', '', '| 种子 | 接缝 | 物件唯一 | 局部性 | 马路连通 | 人行道通马路 | 地块在范围 | 中心可达 |', '|---|---|---|---|---|---|---|---|');
  const cell = (c: Check | null) => (c ? `${mark(c.ok)}` : '-');
  for (const s of stats) {
    L.push(`| ${s.seed} | ${cell(s.seam)} | ${cell(s.unique)} | ${cell(s.locality)} | ${cell(s.roads)} | ${cell(s.sidewalks)} | ${cell(s.ranges)} | ${cell(s.centreReach)} |`);
  }
  L.push('');
  const checks: [string, (s: SeedStat) => Check | null][] = [['接缝', s => s.seam], ['物件唯一', s => s.unique], ['局部性', s => s.locality], ['马路连通', s => s.roads], ['人行道通马路', s => s.sidewalks], ['地块在范围', s => s.ranges], ['中心可达', s => s.centreReach]];
  for (const [name, f] of checks) {
    const rs = stats.map(s => [s.seed, f(s)] as const).filter((x): x is [string, Check] => !!x[1]);
    const bad = rs.filter(([, c]) => !c.ok);
    if (bad.length) failed = true;
    L.push(`- ${name}：${mark(!bad.length)}（${rs.length - bad.length}/${rs.length} 个种子）${bad.length ? '；' + bad.map(([s, c]) => `${s}: ${c.detail}`).join('；') : rs[0] ? `；例：${rs[0][1].detail}` : ''}`);
  }
  L.push('');

  const sum = (v: number[]) => v.reduce((p, q) => p + q, 0);
  const blocks = sum(stats.map(s => s.blocks));
  const pct = (n: number) => `${(100 * n / blocks).toFixed(0)}%`;
  const zones: Record<string, number> = {};
  for (const s of stats) for (const [z, n] of Object.entries(s.zones)) zones[z] = (zones[z] ?? 0) + n;
  L.push('## 分布', '', `- 街区数（有地块格的）：合计 ${blocks}，每个种子 ${fmt(sorted(stats.map(s => s.blocks)))}（最小 / 中位 / 最大）`);
  L.push(`- 地块宽 最小 / 中位 / 最大：${fmt(sorted(stats.flatMap(s => s.lotW)))}；地块高：${fmt(sorted(stats.flatMap(s => s.lotH)))}`);
  L.push(`- 分区占比：${Object.entries(zones).sort().map(([z, n]) => `${z} ${n} (${pct(n)})`).join('，')}`);
  const jog = sum(stats.map(s => s.jog));
  L.push(`- jog 占比：${jog} (${pct(jog)})`);
  const TB = [['< 0.25', 0, 0.25], ['< 0.5', 0.25, 0.5], ['< 0.75', 0.5, 0.75], ['≥ 0.75', 0.75, Infinity]] as const;
  const allT = stats.flatMap(s => s.byT);
  L.push('- 按繁荣度 t 分四档（街区数；地块宽 / 高 最小 / 中位 / 最大；不含特色街区和小岛）：');
  for (const [name, lo, hi] of TB) {
    const g = allT.filter(x => x.t >= lo && x.t < hi);
    L.push(`  - t ${name}：${g.length} 个，宽 ${fmt(sorted(g.map(x => x.w)))}，高 ${fmt(sorted(g.map(x => x.h)))}`);
  }
  L.push('');
  const dk: Record<string, number> = {};
  for (const s of stats) for (const [k, n] of Object.entries(s.districts)) dk[k] = (dk[k] ?? 0) + n;
  const dn = sum(Object.values(dk));
  L.push('## 特色街区', '', `- 合计 ${dn} 个，占街区 ${pct(dn)}`);
  for (const [k, n] of Object.entries(dk).sort()) L.push(`  - ${k}：${n}`);
  L.push('');
  const cs = { plaza: sum(stats.map(s => s.centres.plaza)), garden: sum(stats.map(s => s.centres.garden)), carved: sum(stats.map(s => s.centres.carved)) };
  L.push('## 中心广场', '', `- 广场 ${cs.plaza} 个，中庭 ${cs.garden} 个，实际刻出 ${cs.carved} 个`, '');

  const viol: Record<string, number> = {};
  for (const s of stats) for (const [c, n] of Object.entries(s.violations)) viol[c] = (viol[c] ?? 0) + n;
  const vt = sum(stats.map(s => s.violationsTotal));
  L.push('## 约束', '', `- 修复后剩余违规（中心落在本街区拥有的格）：合计 ${vt}，每个种子平均 ${(vt / stats.length).toFixed(1)}，每街区 ${(vt / Math.max(1, blocks)).toFixed(3)}`);
  for (const [c, n] of Object.entries(viol).sort()) L.push(`  - ${c}：${n}（${stats.filter(s => s.violations[c]).length} 个种子）`);
  const bigN = sum(stats.map(s => s.big.blocks)), bigV = sum(stats.map(s => s.big.violations));
  L.push(`- 大街区（地块 ≥ ${CENTRE_MIN.w}×${CENTRE_MIN.h}）${bigN} 个，剩余违规 ${bigV}，每街区 ${(bigV / Math.max(1, bigN)).toFixed(3)}；其余街区 ${blocks - bigN} 个，剩余违规 ${vt - bigV}，每街区 ${((vt - bigV) / Math.max(1, blocks - bigN)).toFixed(3)}`);
  if (base) {
    const rs = stats.map(s => join(base, `${s.seed}.audit.json`)).filter(existsSync).map(f => sum(Object.values(JSON.parse(readFileSync(f, 'utf8')).counts as Record<string, number>)));
    L.push(`- 单街区快照（${base}）：${rs.length}/${stats.length} 个种子有记录，每个种子平均剩余违规 ${rs.length ? (sum(rs) / rs.length).toFixed(1) : '-'}；世界区域（每个种子 ${(blocks / stats.length).toFixed(0)} 个街区）平均 ${(vt / stats.length).toFixed(1)}`);
  }
  L.push('');
  if (prev) comparison(L, stats);
  const ms = stats.map(s => s.ms);
  L.push('## 耗时', '', `- 每个种子（含检查）：平均 ${(sum(ms.map(m => m.total)) / stats.length / 1000).toFixed(1)} s，最长 ${(Math.max(...ms.map(m => m.total)) / 1000).toFixed(1)} s`);
  L.push(`- 街区生成：平均 ${(sum(ms.map(m => m.blockAvg)) / stats.length).toFixed(0)} ms，最长 ${Math.max(...ms.map(m => m.blockMax)).toFixed(0)} ms`);
  L.push(`- 区块组装（街区已缓存）：平均 ${(sum(ms.map(m => m.chunkAvg)) / stats.length).toFixed(1)} ms，最长 ${Math.max(...ms.map(m => m.chunkMax)).toFixed(1)} ms`);
  L.push(`- 总耗时 ${((Date.now() - t0) / 1000).toFixed(0)} s（${jobs} 个进程）`, '', `总判定：${mark(!failed)}`);
  writeFileSync(join(outDir, 'report.md'), L.join('\n') + '\n');
  console.log(L.join('\n'));
  if (failed) process.exit(1);
}

// '## 对比' table: this run against the per-seed JSON of an older cityregress directory, both sides summed over the
// seeds present in both; the columns are labelled with the two directories' names
function comparison(L: string[], stats: SeedStat[]): void {
  const both = stats.filter(s => existsSync(join(prev!, `${s.seed}.json`)));
  const old = both.map(s => JSON.parse(readFileSync(join(prev!, `${s.seed}.json`), 'utf8')) as SeedStat);
  const sum = (v: number[]) => v.reduce((p, q) => p + q, 0);
  const fmt = (v: number[]) => (v.length ? `${v[0]} / ${v[Math.floor(v.length / 2)]} / ${v[v.length - 1]}` : '-');
  const totals = (ss: SeedStat[]) => {
    const viol: Record<string, number> = {};
    for (const s of ss) for (const [c, n] of Object.entries(s.violations)) viol[c] = (viol[c] ?? 0) + n;
    return { blocks: sum(ss.map(s => s.blocks)), vt: sum(ss.map(s => s.violationsTotal)), viol };
  };
  const o = totals(old), n = totals(both);
  const per = (v: number, k: number) => (v / Math.max(1, k)).toFixed(3);
  L.push(`## 对比（${prev}，两边都有的种子 ${both.length}/${stats.length} 个，只算这些）`, '', `| | ${basename(resolve(prev!))} | ${basename(resolve(outDir))} |`, '|---|---|---|');
  L.push(`| 有地块的街区数 | ${o.blocks} | ${n.blocks} |`);
  L.push(`| 地块宽 最小 / 中位 / 最大 | ${fmt(sorted(old.flatMap(s => s.lotW)))} | ${fmt(sorted(both.flatMap(s => s.lotW)))} |`);
  L.push(`| 地块高 最小 / 中位 / 最大 | ${fmt(sorted(old.flatMap(s => s.lotH)))} | ${fmt(sorted(both.flatMap(s => s.lotH)))} |`);
  L.push(`| 剩余违规合计 | ${o.vt} | ${n.vt} |`, `| 剩余违规每街区 | ${per(o.vt, o.blocks)} | ${per(n.vt, n.blocks)} |`);
  for (const c of [...new Set([...Object.keys(o.viol), ...Object.keys(n.viol)])].sort()) L.push(`| ${c} | ${o.viol[c] ?? 0} | ${n.viol[c] ?? 0} |`);
  L.push('');
}
