// Regression seed set: snapshot the visual output of every seed, and compare two snapshots.
//   npx tsx scripts/regress.ts snapshot <outDir> [--pd]  writes <outDir>/<seed>.json (visual signature) and
//                                                        <seed>.audit.json (constraint audit); --pd = draft repairs on
//        snapshot flags: --nov <x> (novelty, default the generator's), --noprefs (learned preferences off),
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
const pd = flag('--pd');
const shard = value('--shard'), jobs = Number(value('--jobs') ?? 8), nov = value('--nov');
const valued = new Set(['--shard', '--jobs', '--nov']);
type Mode = { pruneDraft?: boolean; novelty?: number; prefs?: boolean };
/** generator options of a snapshot mode (also replayed by the label tests of `report`) */
const modeOpts = (m: Mode) => ({ pruneDraft: !!m.pruneDraft,
  ...(m.novelty !== undefined ? { novelty: m.novelty } : {}), ...(m.prefs === false ? { prefs: false } : {}) });
const mode: Mode = { pruneDraft: pd, ...(nov !== undefined ? { novelty: Number(nov) } : {}), ...(flag('--noprefs') ? { prefs: false } : {}) };
const [cmd, a, b] = args.filter((x, i) => !x.startsWith('--') && !valued.has(args[i - 1]));
const here = dirname(fileURLToPath(import.meta.url));

const snapIndex = () => { const g = generate('1');
  return { version: g.version, seeds: SEEDS.length, ...mode, novelty: mode.novelty ?? g.options?.novelty, prefs: mode.prefs !== false, created: new Date().toISOString() }; };
/** stage 7: what novelty / the learned preferences did to one seed; ms: generation time */
interface LearnSnap { novel: number; adjusted: number; novelty: number; prefs: boolean; ms?: number }
const readLearn = (dir: string, s: string): LearnSnap | null => existsSync(join(dir, `${s}.learn.json`)) ? JSON.parse(readFileSync(join(dir, `${s}.learn.json`), 'utf8')) : null;

type AuditSnap = { counts: Record<string, number>; before: Record<string, number>; pruned: { c: string; key: string; gid?: string }[]; downgraded: { c: string; kind: string }[] };
const readAudit = (dir: string, s: string): AuditSnap | null => existsSync(join(dir, `${s}.audit.json`)) ? JSON.parse(readFileSync(join(dir, `${s}.audit.json`), 'utf8')) : null;

if (cmd === 'snapshot' && a) {
  mkdirSync(a, { recursive: true });
  const [k, n] = shard ? shard.split('/').map(Number) : [0, 1];
  for (const s of SEEDS.filter((_, i) => i % n === k)) {
    const t0 = Date.now();
    const sc = generate(s, modeOpts(mode));
    const ms = Date.now() - t0;
    writeFileSync(join(a, `${s}.json`), JSON.stringify(signature(sc)));
    const ds = (sc.trace?.decisions ?? []) as { m?: unknown }[];
    const ls: LearnSnap = { novel: sc.objects.filter(o => o.novel).length, adjusted: ds.filter(d => d.m).length,
      novelty: sc.options?.novelty ?? 0, prefs: sc.options?.prefs !== false, ms };
    writeFileSync(join(a, `${s}.learn.json`), JSON.stringify(ls));
    const au = sc.audit!;
    writeFileSync(join(a, `${s}.audit.json`), JSON.stringify({ counts: au.counts, before: au.before, pruned: au.pruned.map(p => ({ c: p.c, key: p.key, gid: p.gid })), downgraded: au.downgraded.map(d => ({ c: d.c, kind: d.kind })) }));
  }
  if (!shard) writeFileSync(join(a, 'index.json'), JSON.stringify(snapIndex()));
  console.log(`snapshot${shard ? ` shard ${shard}` : ''}: -> ${a}${pd ? ' (draft repairs on)' : ''}`);
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
  // stage 7: novelty and learned preferences
  const lr = (dir: string) => SEEDS.map(s => readLearn(dir, s)).filter((x): x is LearnSnap => !!x);
  const LA = lr(a), LB = lr(b);
  const lsum = (L: LearnSnap[], k: 'novel' | 'adjusted') => L.reduce((p, l) => p + l[k], 0);
  const lcell = (L: LearnSnap[], k: 'novel' | 'adjusted') => L.length ? `${lsum(L, k)} / ${L.filter(l => l[k]).length} 个种子（平均每张 ${(lsum(L, k) / L.length).toFixed(1)}）` : '（旧快照，无记录）';
  console.log('学习与创新度                                          A → B');
  console.log(`  创新度 / 偏好                      ${LA.length ? `${LA[0].novelty} / ${LA[0].prefs ? '开' : '关'}` : '（旧快照，无记录）'} → ${LB.length ? `${LB[0].novelty} / ${LB[0].prefs ? '开' : '关'}` : '（旧快照，无记录）'}`);
  console.log(`  novel 物件（合计 / 涉及种子）      ${lcell(LA, 'novel')} → ${lcell(LB, 'novel')}`);
  console.log(`  被乘子改动的决策数（合计 / 涉及种子）${lcell(LA, 'adjusted')} → ${lcell(LB, 'adjusted')}`);
  const ms = (L: LearnSnap[]) => { const t = L.map(l => l.ms).filter((x): x is number => x !== undefined); return t.length ? `${(t.reduce((p, q) => p + q, 0) / t.length / 1000).toFixed(2)} / ${(Math.max(...t) / 1000).toFixed(2)}` : '-'; };
  console.log(`  每张图耗时（平均 / 最长，秒）       ${ms(LA)} → ${ms(LB)}`);
  // labels are replayed in B's mode (draft repairs on when B was snapshotted with --pd)
  const bIdx = existsSync(join(b, 'index.json')) ? JSON.parse(readFileSync(join(b, 'index.json'), 'utf8')) : {};
  for (const l of formatLabelTests(runLabelTests(modeOpts(bIdx)))) console.log(l);
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
