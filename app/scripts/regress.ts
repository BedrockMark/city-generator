// Regression seed set: snapshot the visual output of every seed, and compare two snapshots.
//   npx tsx scripts/regress.ts snapshot <outDir>        writes <outDir>/<seed>.json (visual signature) + index
//   npx tsx scripts/regress.ts compare <dirA> <dirB>    reports seeds whose picture changed
// The visual signature is exactly what the renderers draw (ground tiles + sprite/char draw list), so
// "signature equal" means "picture identical"; explanation fields (gid, reason, trace ...) are ignored.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from '../src/gen/generate';
import type { Scene } from '../src/gen/types';

const here = dirname(fileURLToPath(import.meta.url));
export const SEEDS: string[] = JSON.parse(readFileSync(join(here, 'regression_seeds.json'), 'utf8')).seeds;

export function signature(sc: Scene) {
  return {
    cols: sc.cols, rows: sc.rows, ground: sc.ground,
    objects: sc.objects.map(o => [o.kind, o.file, o.key, o.x, o.y, o.foot, o.sub ?? 0, o.solid ?? null, o.layers ?? null, o.frame ?? null]),
  };
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === 'snapshot' && a) {
  mkdirSync(a, { recursive: true });
  for (const s of SEEDS) writeFileSync(join(a, `${s}.json`), JSON.stringify(signature(generate(s))));
  console.log(`snapshot: ${SEEDS.length} seeds -> ${a}`);
} else if (cmd === 'compare' && a && b) {
  const changed: string[] = [];
  for (const s of SEEDS) {
    const fa = join(a, `${s}.json`), fb = join(b, `${s}.json`);
    if (!existsSync(fa) || !existsSync(fb) || readFileSync(fa, 'utf8') !== readFileSync(fb, 'utf8')) changed.push(s);
  }
  console.log(`compare: ${SEEDS.length - changed.length}/${SEEDS.length} identical` + (changed.length ? `; changed: ${changed.join(' ')}` : ''));
  process.exit(changed.length ? 1 : 0);
} else if (cmd === 'explain') {
  // explanation coverage: every object has a group, reason and anchor; every random decision is labelled
  let objs = 0, noGid = 0, noReason = 0, noAnchor = 0, unl = 0, dec = 0, groups = 0, empty = 0, zones = 0, bytes = 0;
  const missing = new Map<string, number>();
  for (const s of SEEDS) {
    const sc = generate(s);
    bytes += JSON.stringify(sc).length;
    for (const o of sc.objects) {
      objs++;
      if (!o.gid) { noGid++; missing.set(o.key, (missing.get(o.key) ?? 0) + 1); }
      if (!o.reason) noReason++;
      if (!o.anchor) noAnchor++;
    }
    unl += sc.trace!.unlabelled; dec += sc.trace!.decisions.length;
    groups += sc.groups!.length; empty += sc.groups!.filter(g => !g.members.length).length; zones += sc.zones!.length;
  }
  const n = SEEDS.length;
  console.log(`objects ${objs}: no gid ${noGid}, no reason ${noReason}, no anchor ${noAnchor}`);
  console.log(`per scene: ${(dec / n).toFixed(0)} decisions, ${(groups / n).toFixed(1)} groups (${(empty / n).toFixed(1)} empty), ${(zones / n).toFixed(0)} zones, ${(bytes / n / 1024).toFixed(0)} KB JSON`);
  console.log(`unlabelled draws: ${unl}`);
  if (missing.size) console.log('no gid:', [...missing].slice(0, 10));
  process.exit(noGid || noReason || noAnchor || unl ? 1 : 0);
} else { console.error('usage: regress.ts snapshot <dir> | compare <dirA> <dirB> | explain'); process.exit(2); }
