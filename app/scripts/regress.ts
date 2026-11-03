// Regression seed set: snapshot the visual output of every seed, and compare two snapshots.
//   npx tsx scripts/regress.ts snapshot <outDir> [--pd]  writes <outDir>/<seed>.json (visual signature) and
//                                                        <seed>.audit.json (constraint audit); --pd = draft repairs on
//   npx tsx scripts/regress.ts compare <dirA> <dirB>     reports seeds whose picture changed
//   npx tsx scripts/regress.ts report <dirA> <dirB>      stage 5 report: picture changes, constraint violations and
//                                                        repairs before / after, the user's labels (labeltests.ts)
//   npx tsx scripts/regress.ts labels                    label tests only
// The visual signature is exactly what the renderers draw (ground tiles + sprite/char draw list), so
// "signature equal" means "picture identical"; explanation fields (gid, reason, trace ...) are ignored.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from '../src/gen/generate';
import type { Scene } from '../src/gen/types';

import { SEEDS } from './seeds';
import { CONSTRAINTS } from '../src/gen/rational/constraints';
import { runLabelTests, formatLabelTests } from './labeltests';

export function signature(sc: Scene) {
  return {
    cols: sc.cols, rows: sc.rows, ground: sc.ground,
    objects: sc.objects.map(o => [o.kind, o.file, o.key, o.x, o.y, o.foot, o.sub ?? 0, o.solid ?? null, o.layers ?? null, o.frame ?? null]),
  };
}

const args = process.argv.slice(2);
const pd = args.includes('--pd');
const [cmd, a, b] = args.filter(x => x !== '--pd');

type AuditSnap = { counts: Record<string, number>; before: Record<string, number>; pruned: { c: string; key: string; gid?: string }[]; downgraded: { c: string; kind: string }[] };
const readAudit = (dir: string, s: string): AuditSnap | null => existsSync(join(dir, `${s}.audit.json`)) ? JSON.parse(readFileSync(join(dir, `${s}.audit.json`), 'utf8')) : null;

if (cmd === 'snapshot' && a) {
  mkdirSync(a, { recursive: true });
  for (const s of SEEDS) {
    const sc = generate(s, { pruneDraft: pd });
    writeFileSync(join(a, `${s}.json`), JSON.stringify(signature(sc)));
    const au = sc.audit!;
    writeFileSync(join(a, `${s}.audit.json`), JSON.stringify({ counts: au.counts, before: au.before, pruned: au.pruned.map(p => ({ c: p.c, key: p.key, gid: p.gid })), downgraded: au.downgraded.map(d => ({ c: d.c, kind: d.kind })) }));
  }
  writeFileSync(join(a, 'index.json'), JSON.stringify({ version: generate('1').version, seeds: SEEDS.length, pruneDraft: pd, created: new Date().toISOString() }));
  console.log(`snapshot: ${SEEDS.length} seeds -> ${a}${pd ? ' (draft repairs on)' : ''}`);
} else if (cmd === 'report' && a && b) {
  const changed: string[] = [];
  const sum = (dir: string) => {
    const t = { counts: {} as Record<string, number>, seeds: {} as Record<string, number>, pruned: {} as Record<string, number>, down: 0, missing: 0 };
    for (const s of SEEDS) {
      const au = readAudit(dir, s); if (!au) { t.missing++; continue; }
      for (const [c, n] of Object.entries(au.counts)) { t.counts[c] = (t.counts[c] ?? 0) + n; if (n) t.seeds[c] = (t.seeds[c] ?? 0) + 1; }
      for (const p of au.pruned) t.pruned[p.c] = (t.pruned[p.c] ?? 0) + 1;
      t.down += au.downgraded.length;
    }
    return t;
  };
  for (const s of SEEDS) {
    const fa = join(a, `${s}.json`), fb = join(b, `${s}.json`);
    if (!existsSync(fa) || !existsSync(fb) || readFileSync(fa, 'utf8') !== readFileSync(fb, 'utf8')) changed.push(s);
  }
  const A = sum(a), B = sum(b);
  console.log(`画面：${SEEDS.length - changed.length}/${SEEDS.length} 相同${changed.length ? `；变化的种子（前 30 个）：${changed.slice(0, 30).join(' ')}` : ''}`);
  if (A.missing || B.missing) console.log(`（没有约束记录的种子：A ${A.missing}，B ${B.missing}；旧快照需要重建）`);
  console.log('约束违规（修复后剩余，合计 / 涉及种子）    A → B      剪掉的物件 A → B');
  for (const c of CONSTRAINTS) console.log(`  ${c.id} ${c.title.padEnd(18, '　')} ${String(A.counts[c.id] ?? '-').padStart(4)} / ${String(A.seeds[c.id] ?? 0).padStart(3)} → ${String(B.counts[c.id] ?? '-').padStart(4)} / ${String(B.seeds[c.id] ?? 0).padStart(3)}     ${A.pruned[c.id] ?? 0} → ${B.pruned[c.id] ?? 0}`);
  console.log(`降级区域：${A.down} → ${B.down}`);
  console.log('评判器得分：阶段 6 才有');
  // labels are replayed in B's mode (draft repairs on when B was snapshotted with --pd)
  const bIdx = existsSync(join(b, 'index.json')) ? JSON.parse(readFileSync(join(b, 'index.json'), 'utf8')) : {};
  for (const l of formatLabelTests(runLabelTests({ pruneDraft: !!bIdx.pruneDraft }))) console.log(l);
} else if (cmd === 'labels') {
  const rs = runLabelTests(pd ? { pruneDraft: true } : {});
  for (const l of formatLabelTests(rs)) console.log(l);
  process.exit(rs.some(r => r.status === 'fail') ? 1 : 0);
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
} else { console.error('usage: regress.ts snapshot <dir> [--pd] | compare <dirA> <dirB> | report <dirA> <dirB> | labels | explain'); process.exit(2); }
