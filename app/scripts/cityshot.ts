// Export a world region as one scene JSON and print its statistics:
//   npx tsx scripts/cityshot.ts <outDir> <seed> [x0,y0,w,h]          (default -60,-44,360,264: about 3 x 3 arterial cells)
// Writes <outDir>/city_<seed>.json; render it with tools/render_generated.py.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assembleRegion, blocksIn } from '../src/world/region';
import { generateBlock } from '../src/world/window';
import { blockById } from '../src/world/blocks';
import type { Rect } from '../src/world/types';

const [outDir, seed, rectArg = '-60,-44,360,264'] = process.argv.slice(2);
const nums = rectArg.split(',').map(Number);
if (!outDir || !seed || nums.length !== 4 || nums.some(n => !Number.isInteger(n))) {
  console.error('usage: cityshot.ts <outDir> <seed> [x0,y0,w,h]');
  process.exit(1);
}
const [x0, y0, w, h] = nums;
const r: Rect = { x0, y0, x1: x0 + w, y1: y0 + h };
mkdirSync(outDir, { recursive: true });

const t0 = performance.now();
const ids = blocksIn(seed, r);
// generate every block once first (timed); assembleRegion then hits the cache
const times: number[] = [], audit: Record<string, number> = {};
for (const id of ids) {
  const t = performance.now();
  const { scene } = generateBlock(seed, id);
  times.push(performance.now() - t);
  for (const [c, n] of Object.entries(scene.audit?.counts ?? {})) audit[c] = (audit[c] ?? 0) + n;
}
const tBlocks = performance.now();
const sc = assembleRegion(seed, r);
const file = join(outDir, `city_${seed}.json`);
writeFileSync(file, JSON.stringify(sc));
const tEnd = performance.now();

const blocks = ids.map(id => blockById(seed, id));
// lot size: the footprint's bounding box minus the sidewalk ring
const lotW = blocks.map(b => Math.max(...b.foot.map(f => f.x1)) - Math.min(...b.foot.map(f => f.x0)) - 2 * b.sw).sort((a, b) => a - b);
const lotH = blocks.map(b => Math.max(...b.foot.map(f => f.y1)) - Math.min(...b.foot.map(f => f.y0)) - 2 * b.sw).sort((a, b) => a - b);
const mmm = (v: number[]) => `${v[0]} / ${v[Math.floor(v.length / 2)]} / ${v[v.length - 1]}`;
const pct = (n: number) => `${(100 * n / blocks.length).toFixed(0)}%`;
const zones: Record<string, number> = {};
for (const b of blocks) zones[b.zone] = (zones[b.zone] ?? 0) + 1;
const left = Object.entries(audit).filter(([, n]) => n > 0).sort();

console.log(`seed ${seed}: rect ${x0},${y0} ${w}x${h} -> ${file} (${sc.cols}x${sc.rows} cells, ${sc.objects.length} objects, ${sc.buildings?.length ?? 0} buildings)`);
console.log(`  blocks: ${blocks.length}`);
console.log(`  lot w min/median/max: ${mmm(lotW)}; lot h min/median/max: ${mmm(lotH)}`);
console.log(`  zones: ${Object.entries(zones).sort().map(([z, n]) => `${z} ${n} (${pct(n)})`).join(', ')}`);
console.log(`  jog: ${blocks.filter(b => b.shape === 'jog').length} (${pct(blocks.filter(b => b.shape === 'jog').length)})`);
console.log(`  violations left (sum over blocks): ${left.reduce((s, [, n]) => s + n, 0)}${left.length ? ' — ' + left.map(([c, n]) => `${c} ${n}`).join(', ') : ''}`);
console.log(`  block generation: avg ${(times.reduce((s, t) => s + t, 0) / times.length).toFixed(0)} ms, max ${Math.max(...times).toFixed(0)} ms`);
console.log(`  runtime: blocks ${((tBlocks - t0) / 1000).toFixed(1)} s, assembly + write ${((tEnd - tBlocks) / 1000).toFixed(1)} s, total ${((tEnd - t0) / 1000).toFixed(1)} s`);
