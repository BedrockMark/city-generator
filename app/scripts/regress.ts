// Regression seed set: snapshot the visual output of every seed, and compare two snapshots.
//   npx tsx scripts/regress.ts snapshot <outDir> [--pd]  writes <outDir>/<seed>.json (visual signature) and
//                                                        <seed>.audit.json (constraint audit); --pd = draft repairs on
//        snapshot flags: --off <exp-id> (that experiment off), --global (judge repair global tier on),
//                        --shard k/n (only the seeds i with i % n = k; used by snapshot-par)
//   npx tsx scripts/regress.ts snapshot-par <outDir> [flags] [--jobs 8]   the same in n parallel processes
//   npx tsx scripts/regress.ts compare <dirA> <dirB>     reports seeds whose picture changed
//   npx tsx scripts/regress.ts report <dirA> <dirB>      stage 5 report: picture changes, constraint violations and
//                                                        repairs before / after, the user's labels (labeltests.ts)
//   npx tsx scripts/regress.ts labels                    label tests only
// The visual signature is exactly what the renderers draw (ground tiles + sprite/char draw list), so
// "signature equal" means "picture identical"; explanation fields (gid, reason, trace ...) are ignored.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from '../src/gen/generate';
import type { Scene } from '../src/gen/types';

import { SEEDS } from './seeds';
import { CONSTRAINTS } from '../src/gen/rational/constraints';
import { runLabelTests, formatLabelTests } from './labeltests';

import { signature } from '../src/gen/signature';
export { signature };

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const value = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const pd = flag('--pd'), global = flag('--global');
const off = value('--off'), shard = value('--shard'), jobs = Number(value('--jobs') ?? 8);
const valued = new Set(['--off', '--shard', '--jobs']);
const [cmd, a, b] = args.filter((x, i) => !x.startsWith('--') && !valued.has(args[i - 1]));
const here = dirname(fileURLToPath(import.meta.url));

/** what the judge and its repair did to one seed (stage 6) */
interface JudgeSnap { mean: number; max: number; meanBefore: number; targets: number; adopted: number; degraded: number; global: boolean; ms: number; gens: number; reportOnly: Record<string, number>; exp02: number }
const readJudge = (dir: string, s: string): JudgeSnap | null => existsSync(join(dir, `${s}.judge.json`)) ? JSON.parse(readFileSync(join(dir, `${s}.judge.json`), 'utf8')) : null;
const snapIndex = () => ({ version: generate('1', { judgeRepair: false }).version, seeds: SEEDS.length, pruneDraft: pd, off, global, created: new Date().toISOString() });

type AuditSnap = { counts: Record<string, number>; before: Record<string, number>; pruned: { c: string; key: string; gid?: string }[]; downgraded: { c: string; kind: string }[] };
const readAudit = (dir: string, s: string): AuditSnap | null => existsSync(join(dir, `${s}.audit.json`)) ? JSON.parse(readFileSync(join(dir, `${s}.audit.json`), 'utf8')) : null;

if (cmd === 'snapshot' && a) {
  mkdirSync(a, { recursive: true });
  const [k, n] = shard ? shard.split('/').map(Number) : [0, 1];
  for (const s of SEEDS.filter((_, i) => i % n === k)) {
    const t0 = Date.now();
    const sc = generate(s, { pruneDraft: pd, judgeGlobal: global, ...(off ? { exp: { [off]: false } } : {}) });
    const jr = sc.judgeRepair, j = sc.judge!;
    const js: JudgeSnap = { mean: j.mean, max: j.max, meanBefore: jr?.meanBefore ?? j.mean, targets: jr?.windows.length ?? 0,
      adopted: jr?.windows.filter(w => w.adopted !== undefined).length ?? 0, degraded: jr?.windows.filter(w => w.degraded && w.degraded !== 'rejected').length ?? 0,
      global: jr?.globalAdopted !== undefined, ms: Date.now() - t0, gens: jr?.gens ?? 0,
      reportOnly: Object.fromEntries(['C19', 'C23', 'C24'].map(c => [c, sc.audit!.counts[c] ?? 0])), exp02: sc.objects.filter(o => o.exp === 'exp-02').length };
    writeFileSync(join(a, `${s}.judge.json`), JSON.stringify(js));
    writeFileSync(join(a, `${s}.json`), JSON.stringify(signature(sc)));
    const au = sc.audit!;
    writeFileSync(join(a, `${s}.audit.json`), JSON.stringify({ counts: au.counts, before: au.before, pruned: au.pruned.map(p => ({ c: p.c, key: p.key, gid: p.gid })), downgraded: au.downgraded.map(d => ({ c: d.c, kind: d.kind })) }));
  }
  if (!shard) writeFileSync(join(a, 'index.json'), JSON.stringify(snapIndex()));
  console.log(`snapshot${shard ? ` shard ${shard}` : ''}: -> ${a}${pd ? ' (draft repairs on)' : ''}${off ? ` (${off} off)` : ''}${global ? ' (global tier on)' : ''}`);
} else if (cmd === 'snapshot-par' && a) {
  mkdirSync(a, { recursive: true });
  const tsx = createRequire(import.meta.url).resolve('tsx/cli');
  const rest = args.filter((x, i) => i > 1 && x !== '--jobs' && args[i - 1] !== '--jobs');
  const t0 = Date.now();
  Promise.all(Array.from({ length: jobs }, (_, k) => new Promise<number>(res => {
    const p = spawn(process.execPath, [tsx, join(here, 'regress.ts'), 'snapshot', a, ...rest, '--shard', `${k}/${jobs}`], { stdio: ['ignore', 'ignore', 'inherit'] });
    p.on('exit', code => res(code ?? 1));
  }))).then(codes => {
    if (codes.some(c => c)) { console.error(`snapshot-par: shard exit codes ${codes.join(' ')}`); process.exit(1); }
    writeFileSync(join(a, 'index.json'), JSON.stringify(snapIndex()));
    console.log(`snapshot-par: ${SEEDS.length} seeds -> ${a} in ${((Date.now() - t0) / 1000).toFixed(0)} s (${jobs} processes)`);
  });
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
  // stage 6: judge scores and the repair
  const js = (dir: string) => SEEDS.map(s => readJudge(dir, s)).filter((x): x is JudgeSnap => !!x);
  const JA = js(a), JB = js(b);
  if (JA.length && JB.length) {
    const avg = (xs: number[]) => xs.reduce((p, q) => p + q, 0) / Math.max(1, xs.length);
    const med = (xs: number[]) => { const s = [...xs].sort((p, q) => p - q); return s[Math.floor(s.length / 2)] ?? 0; };
    const f = (x: number) => x.toFixed(3);
    const tot = (J: JudgeSnap[], k: 'targets' | 'adopted' | 'degraded' | 'exp02') => J.reduce((p, j) => p + j[k], 0);
    console.log(`评判器（${JA.length} / ${JB.length} 个种子）                A → B`);
    console.log(`  整图平均怪异分（平均 / 中位数）     ${f(avg(JA.map(j => j.mean)))} / ${f(med(JA.map(j => j.mean)))} → ${f(avg(JB.map(j => j.mean)))} / ${f(med(JB.map(j => j.mean)))}`);
    console.log(`  最怪窗口的得分（平均）              ${f(avg(JA.map(j => j.max)))} → ${f(avg(JB.map(j => j.max)))}`);
    console.log(`  B 修复前 → 修复后的整图平均分       ${f(avg(JB.map(j => j.meanBefore)))} → ${f(avg(JB.map(j => j.mean)))}；平均分下降的种子 ${JB.filter(j => j.mean < j.meanBefore - 1e-9).length}，上升 ${JB.filter(j => j.mean > j.meanBefore + 1e-9).length}`);
    console.log(`  修复目标窗口 / 局部档采用 / 降级     ${tot(JA, 'targets')} / ${tot(JA, 'adopted')} / ${tot(JA, 'degraded')} → ${tot(JB, 'targets')} / ${tot(JB, 'adopted')} / ${tot(JB, 'degraded')}`);
    console.log(`  整体档采用（种子数）                ${JA.filter(j => j.global).length} → ${JB.filter(j => j.global).length}`);
    console.log(`  带 exp-02 标记的物件（合计）        ${tot(JA, 'exp02')} → ${tot(JB, 'exp02')}`);
    for (const c of ['C19', 'C23', 'C24']) console.log(`  只报告约束 ${c}（合计 / 涉及种子）     ${JA.reduce((p, j) => p + j.reportOnly[c], 0)} / ${JA.filter(j => j.reportOnly[c]).length} → ${JB.reduce((p, j) => p + j.reportOnly[c], 0)} / ${JB.filter(j => j.reportOnly[c]).length}`);
    console.log(`  每张图耗时（平均 / 最长，秒）       ${(avg(JA.map(j => j.ms)) / 1000).toFixed(1)} / ${(Math.max(...JA.map(j => j.ms)) / 1000).toFixed(1)} → ${(avg(JB.map(j => j.ms)) / 1000).toFixed(1)} / ${(Math.max(...JB.map(j => j.ms)) / 1000).toFixed(1)}；B 平均生成次数 ${avg(JB.map(j => j.gens)).toFixed(1)}`);
  } else console.log('评判器：快照里没有评判记录（v0.6.0 之前的快照）');
  // labels are replayed in B's mode (draft repairs on when B was snapshotted with --pd)
  const bIdx = existsSync(join(b, 'index.json')) ? JSON.parse(readFileSync(join(b, 'index.json'), 'utf8')) : {};
  for (const l of formatLabelTests(runLabelTests({ pruneDraft: !!bIdx.pruneDraft, judgeGlobal: !!bIdx.global, ...(bIdx.off ? { exp: { [bIdx.off]: false } } : {}) }))) console.log(l);
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
