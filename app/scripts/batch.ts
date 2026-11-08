// Generate scenes headlessly: npx tsx scripts/batch.ts <outDir> <seed> [seed ...]
// Seeds may be given as a range "1..8". --d=<kind> generates that special district (exp-08), e.g. --d=gas.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generate } from '../src/gen/generate';

const argv = process.argv.slice(2);
const district = argv.find(a => a.startsWith('--d='))?.slice(4);
const [outDir, ...args] = argv.filter(a => !a.startsWith('--d='));
if (!outDir || !args.length) { console.error('usage: batch.ts <outDir> <seed|a..b> ...'); process.exit(1); }
const seeds: string[] = [];
for (const a of args) {
  const m = a.match(/^(\d+)\.\.(\d+)$/);
  if (m) for (let i = +m[1]; i <= +m[2]; i++) seeds.push(String(i)); else seeds.push(a);
}
mkdirSync(outDir, { recursive: true });
for (const s of seeds) {
  const t0 = performance.now();
  const sc = generate(s, district ? { district: district as never } : {});
  writeFileSync(join(outDir, `scene_${district ? district + '_' : ''}${s}.json`), JSON.stringify(sc));
  console.log(`seed ${s}: ${sc.cols}x${sc.rows} cells, ${sc.objects.length} objects, ${(performance.now() - t0).toFixed(0)} ms ${JSON.stringify(sc.params)}`);
}
