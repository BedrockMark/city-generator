// Export a world region as one scene JSON and print its statistics:
//   npx tsx scripts/cityshot.ts <outDir> <seed> [x0,y0,w,h]          (default -60,-44,360,264: about 3 x 3 arterial cells)
// Writes <outDir>/city_<seed>.json; render it with tools/render_generated.py.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assembleRegion, blocksIn } from '../src/world/region';
import { generateBlock } from '../src/world/window';
import { blockById } from '../src/world/blocks';
import { blockRaster, classRaster, ownerRaster } from '../src/world/cells';
import { TILE } from '../src/gen/types';
import type { Rect } from '../src/world/types';

const [outDir, seed, rectArg = '-60,-44,360,264'] = process.argv.slice(2);
const nums = rectArg.split(',').map(Number);
if (!outDir || !seed || nums.length !== 4 || nums.some(n => !Number.isInteger(n)) || nums[2] <= 0 || nums[3] <= 0) {
  console.error('usage: cityshot.ts <outDir> <seed> [x0,y0,w,h]');
  process.exit(1);
}
const [x0, y0, w, h] = nums;
const r: Rect = { x0, y0, x1: x0 + w, y1: y0 + h };
mkdirSync(outDir, { recursive: true });

const t0 = performance.now();
const ids = blocksIn(seed, r);
// generate every block once first (timed); assembleRegion then hits the cache
const scenes = new Map<string, ReturnType<typeof generateBlock>>(), times: number[] = [];
for (const id of ids) {
  const t = performance.now();
  scenes.set(id, generateBlock(seed, id));
  times.push(performance.now() - t);
}
const tBlocks = performance.now();
const sc = assembleRegion(seed, r);
const file = join(outDir, `city_${seed}.json`);
writeFileSync(file, JSON.stringify(sc));
const tEnd = performance.now();

// statistics cover the blocks with a lot cell inside r; blocksIn also lists those that only own road / sidewalk
// cells of r or only touch its REGION_PAD padding
const cls = classRaster(seed, r), blk = blockRaster(seed, r);
const inR = new Set<string>();
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (cls[y][x] === 'lot') inR.add(blk[y][x]!);
const blocks = ids.filter(id => inR.has(id)).map(id => blockById(seed, id));
// lot size: the footprint's bounding box minus the sidewalk ring
const lotW = blocks.map(b => Math.max(...b.foot.map(f => f.x1)) - Math.min(...b.foot.map(f => f.x0)) - 2 * b.sw).sort((a, b) => a - b);
const lotH = blocks.map(b => Math.max(...b.foot.map(f => f.y1)) - Math.min(...b.foot.map(f => f.y0)) - 2 * b.sw).sort((a, b) => a - b);
const mmm = (v: number[]) => `${v[0]} / ${v[Math.floor(v.length / 2)]} / ${v[v.length - 1]}`;
const pct = (n: number) => `${(100 * n / blocks.length).toFixed(0)}%`;
const zones: Record<string, number> = {};
for (const b of blocks) zones[b.zone] = (zones[b.zone] ?? 0) + 1;
// violations left after repair: every window's audit covers its whole window (rationalize runs before the ownership
// filter, spec 4), so the raw sum also counts neighbours' objects; the region count keeps a violation only when the
// centre cell of its rect is a cell of r owned by the block whose window reported it (the objects' and zones' rule)
const owner = ownerRaster(seed, r);
const raw: Record<string, number> = {}, own: Record<string, number> = {};
for (const [id, { scene, ox, oy }] of scenes) for (const v of scene.audit?.violations ?? []) {
  raw[v.c] = (raw[v.c] ?? 0) + 1;
  const x = ox - x0 + Math.floor((v.rect.x0 + v.rect.x1) / 2 / TILE), y = oy - y0 + Math.floor((v.rect.y0 + v.rect.y1) / 2 / TILE);
  if (x >= 0 && y >= 0 && x < w && y < h && owner[y][x] === id) own[v.c] = (own[v.c] ?? 0) + 1;
}
const list = (a: Record<string, number>) => {
  const e = Object.entries(a).sort();
  return `${e.reduce((s, [, n]) => s + n, 0)}${e.length ? ' — ' + e.map(([c, n]) => `${c} ${n}`).join(', ') : ''}`;
};

console.log(`seed ${seed}: rect ${x0},${y0} ${w}x${h} -> ${file} (${sc.cols}x${sc.rows} cells, ${sc.objects.length} objects, ${sc.buildings?.length ?? 0} buildings)`);
console.log(`  blocks with a lot cell in the rect: ${blocks.length} (generated, incl. REGION_PAD padding: ${ids.length}); stats below over the former`);
console.log(`  lot w min/median/max: ${mmm(lotW)}; lot h min/median/max: ${mmm(lotH)}`);
console.log(`  zones: ${Object.entries(zones).sort().map(([z, n]) => `${z} ${n} (${pct(n)})`).join(', ')}`);
console.log(`  jog: ${blocks.filter(b => b.shape === 'jog').length} (${pct(blocks.filter(b => b.shape === 'jog').length)})`);
console.log(`  violations left in the region (centre on a cell of the rect owned by the reporting block): ${list(own)}`);
console.log(`  violations left, sum per window before the ownership filter (all ${ids.length} windows): ${list(raw)}`);
console.log(`  block generation: avg ${(times.reduce((s, t) => s + t, 0) / times.length).toFixed(0)} ms, max ${Math.max(...times).toFixed(0)} ms`);
console.log(`  runtime: blocks ${((tBlocks - t0) / 1000).toFixed(1)} s, assembly + write ${((tEnd - tBlocks) / 1000).toFixed(1)} s, total ${((tEnd - t0) / 1000).toFixed(1)} s`);
