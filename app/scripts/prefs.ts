// Stage 7 learned preferences (spec 4.3, 7): train the Bradley–Terry table, report on it, find what choices cannot fix.
//   npx tsx scripts/prefs.ts train   A/B choices + label comparisons (blacklist removed) -> app/src/gen/data/prefs.json
//   npx tsx scripts/prefs.ts eval    docs/reports/PREFS.md (generated, do not edit): data counts, held-out accuracy by batch
//                                    (5 folds over choice files; leave-one-batch-out below 5 files), multiplier table
//   npx tsx scripts/prefs.ts gaps    every bad label vs a model trained without its seed's labels: an alternative scoring
//                                    >= 0.05 above the pick = "选择能改善", else "选择解决不了"; work/gaps/gaps.{md,json}
// Choice comparisons whose label (or a / b option) the current generator no longer has (union over the traces of the first
// 20 regression seeds, novelty 0, no preferences) are dropped and counted; choice files are never regenerated.
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, VERSION } from '../src/gen/generate';
import { alternatives, type Decision } from '../src/gen/rng';
import type { PxRect } from '../src/gen/types';
import { fit, score, toTable, filterBlacklist, ctxKeys, M_MIN, M_MAX, type Comparison, type Blacklist, type PrefTable } from '../src/gen/learn/prefs';
import { loadChoiceComparisons, attributeLabels, labelComparisons } from '../src/gen/learn/data';
import { SEEDS } from './seeds';

const here = dirname(fileURLToPath(import.meta.url)), ROOT = join(here, '..', '..');
const PREFS_JSON = join(here, '..', 'src', 'gen', 'data', 'prefs.json'), PREFS_MD = join(ROOT, 'docs', 'reports', 'PREFS.md'), GAPS = join(ROOT, 'work', 'gaps');
const BL = JSON.parse(readFileSync(join(here, '..', 'src', 'gen', 'learn', 'blacklist.json'), 'utf8')) as Blacklist;
const GAP = 0.05;

/** what "exists in the current generator" means for a choice: the labels and their alternatives over the traces of the
 *  first KNOWN_SEEDS regression seeds (novelty 0, no preferences); computed once, only when there are choices */
const KNOWN_SEEDS = 20;
let known: Map<string, Set<string>> | null = null;
function knownOptions() {
  if (known) return known;
  known = new Map();
  for (const seed of SEEDS.slice(0, KNOWN_SEEDS))
    for (const d of (generate(seed, { novelty: 0, prefs: false }).trace?.decisions ?? []) as Decision[]) {
      const s = known.get(d.label) ?? new Set<string>(); alternatives(d).forEach(o => s.add(o)); known.set(d.label, s);
    }
  return known;
}

/** choice comparisons whose label and options still exist (no regeneration of the choice's own seed: spec 3.4) */
function knownChoices(): { cs: Comparison[]; files: number; skipped: number; unknown: number } {
  const r = loadChoiceComparisons();
  if (!r.cs.length) return { ...r, unknown: 0 };
  const k = knownOptions(), cs = r.cs.filter(c => { const s = k.get(c.label); return !!s && s.has(c.a) && s.has(c.b); });
  return { cs, files: r.files, skipped: r.skipped, unknown: r.cs.length - cs.length };
}

function load() {
  const ch = knownChoices(), att = attributeLabels(), lcs = labelComparisons(att.items);
  const all = [...ch.cs, ...lcs], used = filterBlacklist(all, BL);
  return { ch, att, lcs, all, used };
}

/** held-out accuracy by batch over the choice comparisons (ties excluded; equal scores count 0.5) */
function heldOut(choice: Comparison[], labels: Comparison[]) {
  const files = [...new Set(choice.map(c => c.batch))].sort();
  if (!files.length) return null;
  const k = Math.min(5, files.length), fold = new Map(files.map((f, i) => [f, i % k]));
  let hit = 0, n = 0, bs = 0;
  for (let i = 0; i < k; i++) {
    const m = fit(filterBlacklist([...choice.filter(c => fold.get(c.batch) !== i), ...labels], BL));
    for (const c of filterBlacklist(choice.filter(c => fold.get(c.batch) === i && c.answer !== 'same'), BL)) {
      const d = score(m, c.label, c.ctx, c.b) - score(m, c.label, c.ctx, c.a);
      hit += d === 0 ? 0.5 : (d > 0) === (c.answer === 'b') ? 1 : 0; n++; if (c.answer === 'b') bs++;
    }
  }
  return { k, files: files.length, n, acc: n ? hit / n : 0, base: n ? bs / n : 0 };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const fmtM = (m: number) => `×${m.toFixed(2)}`;
const rect = (c?: Comparison) => c?.src.rect ? `(${c.src.rect.x0},${c.src.rect.y0})–(${c.src.rect.x1},${c.src.rect.y1})` : '';

function evalReport(ch: ReturnType<typeof knownChoices>, att: ReturnType<typeof attributeLabels>, lcs: Comparison[], all: Comparison[], used: Comparison[]) {
  const L: string[] = [];
  L.push('# 学到的偏好（PREFS）', '', `由 \`npx tsx scripts/prefs.ts eval\` 生成（生成器 v${VERSION}，${new Date().toISOString().slice(0, 10)}），不要手改。`, '');
  L.push('## 数据量', '');
  const ties = ch.cs.filter(c => c.answer === 'same').length;
  L.push(`- A/B 选择：${ch.files} 个选择文件，比较 ${ch.cs.length} 条，其中平局（差不多）${ties} 条`);
  L.push(`- 没有回答的改动：${ch.skipped} 条；标签或选项在当前生成器里不存在、训练时跳过：${ch.unknown} 条`);
  L.push(`- 来自好 / 坏标注的比较：${lcs.length} 条（${att.items.length} 条标注，好 ${att.items.filter(i => i.label.verdict === 'good').length} / 坏 ${att.items.filter(i => i.label.verdict === 'bad').length}，每条总权重 0.3）`);
  const sig = att.skipped.filter(s => s.why.includes('签名不同')).length;
  L.push(`- 跳过的标注：${att.skipped.length} 条（其中重新生成后画面签名不同 ${sig} 条）`);
  for (const s of att.skipped) L.push(`  - ${s.file}#${s.id}：${s.why}`);
  L.push(`- 黑名单（app/src/gen/learn/blacklist.json）去掉：${all.length - used.length} 条`, '');

  L.push('## 留出准确率', '');
  const h = heldOut(ch.cs, lcs);
  if (!h) L.push('还没有 A/B 选择数据。', '');
  else L.push(`${h.k === 5 ? '按批次 5 折' : `留一批次（${h.files} 个选择文件）`}留出：${h.n} 条非平局比较，预测准确率 ${pct(h.acc)}；基线“总猜 B” ${pct(h.base)}。`, '');

  L.push('## 乘子表', '', '按 |log m| 从大到小；只列 |log m| ≥ 0.05 的选项。', '');
  const t = toTable(fit(used), VERSION), rows: { k: number; s: string }[] = [], clamped: string[] = [];
  for (const [label, e] of Object.entries(t.labels)) {
    const lc = used.filter(c => c.label === label);
    const row = (kv: string | null, r: Record<string, number>) => {
      const ent = Object.entries(r).sort((x, y) => Math.abs(Math.log(y[1])) - Math.abs(Math.log(x[1])));
      if (!ent.length) return;
      const cs = kv ? lc.filter(c => ctxKeys(c.ctx).includes(kv)) : lc, ex = cs.find(c => c.src.rect) ?? cs[0];
      rows.push({ k: Math.abs(Math.log(ent[0][1])), s: `- \`${label}\`${kv ? `［${kv}］` : ''}：${ent.map(([o, m]) => `${o} ${fmtM(m)}`).join('、')}（${cs.length} 次比较${kv ? `，上下文 ${kv}` : ''}）${ex ? `；例：种子 ${ex.src.seed} ${rect(ex)}` : ''}` });
    };
    row(null, e.global);
    for (const [kv, r] of Object.entries(e.ctx)) row(kv, r);
    // applied multiplier = global × context, clamped to [M_MIN, M_MAX]
    for (const [kv, r] of [[null, {}] as [string | null, Record<string, number>], ...Object.entries(e.ctx)])
      for (const o of new Set([...Object.keys(e.global), ...Object.keys(r)])) {
        const m = (e.global[o] ?? 1) * (r[o] ?? 1);
        if (m < M_MIN || m > M_MAX) clamped.push(`- \`${label}\`${kv ? `［${kv}］` : ''} ${o}：${fmtM(m)} → ${fmtM(Math.min(M_MAX, Math.max(M_MIN, m)))}`);
      }
  }
  if (!rows.length) L.push('（偏好表为空）');
  L.push(...rows.sort((a, b) => b.k - a.k).map(r => r.s), '');
  L.push(`## 被截断的乘子（应用时限制在 [${M_MIN}, ${M_MAX}]）`, '', ...(clamped.length ? clamped : ['（没有）']), '');

  L.push('## 你不在意的决策点', '', '只回答过“差不多”的标签：', '');
  const by = new Map<string, Comparison[]>();
  for (const c of ch.cs) by.set(c.label, [...(by.get(c.label) ?? []), c]);
  const indiff = [...by].filter(([, cs]) => cs.every(c => c.answer === 'same')).map(([l, cs]) => `- \`${l}\`（${cs.length} 次）`);
  L.push(...(indiff.length ? indiff : ['（没有）']), '');
  return L.join('\n');
}

interface Gap { file: string; id: string; seed: string; version: string; tags: string[]; text: string; decisions: number; cls: '选择能改善' | '选择解决不了';
  better: { stream: string; label: string; pick: string; alt: string; gain: number }[]; rect: { x0: number; y0: number; x1: number; y1: number }; shot: string | null; skipped?: string }

function gaps() {
  const ch = knownChoices(), att = attributeLabels();
  mkdirSync(join(GAPS, 'scenes'), { recursive: true });
  const models = new Map<string, ReturnType<typeof fit>>();
  const modelFor = (seed: string) => {
    if (!models.has(seed)) models.set(seed, fit(filterBlacklist([...ch.cs, ...labelComparisons(att.items.filter(i => i.label.seed !== seed))], BL)));
    return models.get(seed)!;
  };
  const out: Gap[] = [];
  const crop = (seed: string, id: string, scene: object, r: PxRect) => {
    const stem = `seed${seed}_${id}`, f = join(GAPS, 'scenes', `${stem}.scene.json`), png = join(GAPS, `${stem}.png`);
    writeFileSync(f, JSON.stringify(scene));
    const py = spawnSync('uv', ['run', 'python', 'crop_region.py', f, String(r.x0), String(r.y0), String(r.x1), String(r.y1), png], { cwd: join(ROOT, 'tools'), encoding: 'utf8' });
    if (py.status !== 0) console.error(`crop ${stem} failed: ${py.stderr}`);
    return py.status === 0 ? relative(GAPS, png).split('\\').join('/') : null;
  };
  for (const it of att.items.filter(i => i.label.verdict === 'bad')) {
    const m = modelFor(it.label.seed), better: Gap['better'] = [];
    for (const d of it.decisions) {
      const ctx = d.ctx ?? {}, s0 = score(m, d.label, ctx, d.pick);
      const best = alternatives(d).filter(o => o !== d.pick).map(o => [o, score(m, d.label, ctx, o) - s0] as const).sort((a, b) => b[1] - a[1])[0];
      if (best && best[1] >= GAP) better.push({ stream: d.s, label: d.label, pick: d.pick, alt: best[0], gain: +best[1].toFixed(3) });
    }
    const l = it.label;
    out.push({ file: it.file, id: l.id, seed: l.seed, version: l.version, tags: l.tags, text: l.text, decisions: it.decisions.length,
      cls: better.length ? '选择能改善' : '选择解决不了', better, rect: it.region, shot: crop(l.seed, l.id, it.scene, it.region) });
  }
  // labels with nothing to attribute (or no usable scene): nothing a choice could change
  for (const s of att.skipped.filter(s => s.label.verdict === 'bad')) {
    const l = s.label;
    out.push({ file: s.file, id: l.id, seed: l.seed, version: l.version, tags: l.tags, text: l.text, decisions: 0, cls: '选择解决不了', better: [], rect: s.region,
      shot: crop(l.seed, l.id, s.scene, s.region), skipped: s.why });
  }
  writeFileSync(join(GAPS, 'gaps.json'), JSON.stringify({ version: VERSION, created: new Date().toISOString(), choices: ch.cs.length, skipped: att.skipped.map(({ file, id, why }) => ({ file, id, why })), gaps: out }, null, 2));
  const n = (c: Gap['cls']) => out.filter(g => g.cls === c).length;
  const L = ['# 选择解决不了的问题（gaps）', '', `由 \`npx tsx scripts/prefs.ts gaps\` 生成（v${VERSION}）。每条坏标注用“去掉这条标注所在种子的全部标注”训练的模型（A/B 选择 ${ch.cs.length} 条）判断：`,
    `归因到的决策里有备选项得分比已选项高 ≥ ${GAP} → 选择能改善；否则 → 选择解决不了。`, '',
    `坏标注 ${out.length} 条：选择能改善 ${n('选择能改善')}，选择解决不了 ${n('选择解决不了')}（其中无法归因 ${out.filter(g => g.skipped).length} 条）；跳过的标注 ${att.skipped.length} 条。`, ''];
  const entry = (g: Gap) => [`- 种子 ${g.seed}（v${g.version}，${g.file}#${g.id}）：${g.tags.join('、') || '（无标签）'} — ${g.text || '（无备注）'}`,
    `  - ${g.skipped ? `无法归因（${g.skipped}）` : `归因到的决策 ${g.decisions} 个`}；${g.cls}${g.better.length ? '：' + g.better.map(b => `\`${b.label}\` ${b.pick} → ${b.alt}（+${b.gain}）`).join('、') : ''}`,
    `  - 区域 (${g.rect.x0},${g.rect.y0})–(${g.rect.x1},${g.rect.y1})，截图 ${g.shot ?? '（生成失败）'}`];
  L.push('## 选择解决不了（按标签归类）', '');
  const tags = new Map<string, Gap[]>();
  for (const g of out.filter(g => g.cls === '选择解决不了')) for (const t of g.tags.length ? g.tags : ['（无标签）']) tags.set(t, [...(tags.get(t) ?? []), g]);
  if (!tags.size) L.push('（没有）', '');
  for (const [t, gs] of [...tags].sort((a, b) => b[1].length - a[1].length)) L.push(`### ${t}（${gs.length} 条）`, '', ...gs.flatMap(entry), '');
  L.push('## 选择能改善', '', ...(n('选择能改善') ? out.filter(g => g.cls === '选择能改善').flatMap(entry) : ['（没有）']), '');
  writeFileSync(join(GAPS, 'gaps.md'), L.join('\n'));
  console.log(`坏标注 ${out.length} 条：选择能改善 ${n('选择能改善')}，选择解决不了 ${n('选择解决不了')}；写入 ${relative(ROOT, GAPS)}/gaps.md、gaps.json`);
}

const cmd = process.argv[2];
if (cmd === 'train') {
  const { ch, att, lcs, used, all } = load();
  const t = toTable(fit(used), VERSION), old = existsSync(PREFS_JSON) ? JSON.parse(readFileSync(PREFS_JSON, 'utf8')) as PrefTable : null;
  // unchanged content keeps the old file (and its `trained` time): re-running train is idempotent
  const same = !!old && old.version === t.version && JSON.stringify(old.labels) === JSON.stringify(t.labels);
  if (!same) writeFileSync(PREFS_JSON, JSON.stringify(t, null, 2) + '\n');
  const n = Object.values(t.labels).reduce((s, e) => s + Object.keys(e.global).length + Object.values(e.ctx).reduce((q, r) => q + Object.keys(r).length, 0), 0);
  console.log(`选择 ${ch.cs.length} 条（${ch.files} 个文件，未回答 ${ch.skipped}，标签不存在 ${ch.unknown}），标注 ${lcs.length} 条（${att.items.length} 条标注，跳过 ${att.skipped.length}），黑名单去掉 ${all.length - used.length}`);
  console.log(`prefs.json: ${Object.keys(t.labels).length} 个标签，${n} 个乘子${same ? '（没有变化，未重写）' : ''}`);
} else if (cmd === 'eval') {
  const { ch, att, lcs, all, used } = load();
  writeFileSync(PREFS_MD, evalReport(ch, att, lcs, all, used));
  console.log(`写入 ${relative(ROOT, PREFS_MD)}`);
} else if (cmd === 'gaps') {
  gaps();
} else {
  console.log('usage: npx tsx scripts/prefs.ts train | eval | gaps');
  process.exit(1);
}
