// Stage 6 judge: training and evaluation (docs/superpowers/specs/2026-11-03-stage6-judge-design.md 2.4, 2.5).
//   npx tsx scripts/judge.ts train   -> src/gen/data/judge.json
//   npx tsx scripts/judge.ts eval    -> docs/reports/JUDGE.md, docs/reports/judge/heat_*.png (via tools/heatmap.py)
// Data: every window of the analysed references (work/refworld, label 0), a sample of windows of the first 100
// regression seeds (label 1, 3x the reference windows), and the user's labels from v0.5.1 on (bad = 1, good = 0,
// weight 5). Classes are balanced by weight. The L1 strength is chosen by leave-one-group-out cross-validation over
// the reference near-duplicate groups (tools/refs_meta.json); generated seeds are spread over the same folds.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { generateBase } from '../src/gen/generate';
import { withDefaults } from '../src/gen/exp';
import { alignScene, alignRef, type JWorld } from '../src/gen/judge/align';
import { windows, featureMatrix, activeFeatures, FEATURES, type Win } from '../src/gen/judge/features';
import { fitL1, auc, standardize, scoreMatrix, scoreWorld, type JudgeModel } from '../src/gen/judge/model';
import { loadLabelRegions, coveredWindows } from '../src/gen/judge/labelset';
import { Rng } from '../src/gen/rng';
import type { RefWorldJSON } from '../src/gen/rational/world';
import { SEEDS } from './seeds';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..', '..');
const REFWORLD = join(ROOT, 'work', 'refworld');
const MODEL_FILE = join(here, '..', 'src', 'gen', 'data', 'judge.json');
const LAMBDAS = [0.3, 0.1, 0.03, 0.01, 0.003, 0.001];
const LABEL_W = 5;

interface Sample { x: number[]; y: number; w: number; kind: 'ref' | 'gen' | 'label'; group: string; src: string; win: Win; fold: number }

const feats = activeFeatures();
const featIds = feats.map(f => f.id);

function refWorlds(): { name: string; group: string; w: JWorld }[] {
  const meta = JSON.parse(readFileSync(join(ROOT, 'tools', 'refs_meta.json'), 'utf8')) as Record<string, { group?: string }>;
  return readdirSync(REFWORLD).filter(f => f.endsWith('.json')).sort().map(f => {
    const j = JSON.parse(readFileSync(join(REFWORLD, f), 'utf8')) as RefWorldJSON;
    return { name: j.name, group: meta[j.name]?.group ?? j.name, w: alignRef(j) };
  });
}

/** generated scenes as the judge sees them (no judge repair: the judge learns what the generator proposes) */
const genWorld = (s: string) => alignScene(generateBase(s, withDefaults({})));

function collect() {
  const refs = refWorlds();
  const groups = [...new Set(refs.map(r => r.group))];
  const K = groups.length;
  const samples: Sample[] = [];
  for (const r of refs) {
    const wins = windows(r.w), X = featureMatrix(r.w, wins, feats);
    X.forEach((x, i) => samples.push({ x, y: 0, w: 1, kind: 'ref', group: r.group, src: r.name, win: wins[i], fold: groups.indexOf(r.group) }));
  }
  const nRef = samples.length;
  const pool: Sample[] = [];
  SEEDS.slice(0, 100).forEach((s, si) => {
    const w = genWorld(s), wins = windows(w), X = featureMatrix(w, wins, feats);
    X.forEach((x, i) => pool.push({ x, y: 1, w: 1, kind: 'gen', group: `seed${s}`, src: `seed${s}`, win: wins[i], fold: si % K }));
  });
  const rng = new Rng('judge-sample');
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const gen = pool.slice(0, Math.min(pool.length, 3 * nRef));
  samples.push(...gen);
  // balance: references weigh as much as the generated sample in total
  for (const s of samples) if (s.kind === 'ref') s.w = gen.length / nRef;
  const labels = loadLabelRegions();
  for (const l of labels) {
    const w = alignScene(l.scene), wins = windows(w), X = featureMatrix(w, wins, feats);
    for (const i of coveredWindows(l.rect, wins))
      samples.push({ x: X[i], y: l.verdict === 'bad' ? 1 : 0, w: LABEL_W, kind: 'label', group: `label:${l.seed}`, src: `seed${l.seed} ${l.id}`, win: wins[i], fold: -1 });
  }
  return { samples, refs, groups, labels, poolSize: pool.length };
}

function fit(train: Sample[], lambda: number, st: { mean: number[]; std: number[] }) {
  const Z = train.map(s => s.x.map((v, j) => (v - st.mean[j]) / st.std[j]));
  return fitL1(Z, train.map(s => s.y), train.map(s => s.w), lambda);
}
const toModel = (f: { w: number[]; b: number }, st: { mean: number[]; std: number[] }, lambda: number, extra: Partial<JudgeModel> = {}): JudgeModel =>
  ({ features: featIds, mean: st.mean, std: st.std, w: f.w, b: f.b, lambda, threshold: 1, refMeanP90: 1, trained: '', data: {}, ...extra });

/** out-of-fold scores of the reference and generated samples (leave one reference group out) */
function crossVal(samples: Sample[], K: number, lambda: number, st: { mean: number[]; std: number[] }): Map<Sample, number> {
  const out = new Map<Sample, number>();
  for (let k = 0; k < K; k++) {
    const test = samples.filter(s => s.fold === k), train = samples.filter(s => s.fold !== k);
    if (!test.length) continue;
    const m = toModel(fit(train, lambda, st), st, lambda);
    scoreMatrix(m, test.map(s => s.x)).p.forEach((p, i) => out.set(test[i], p));
  }
  return out;
}

const pct = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0; };
const aucOf = (m: Map<Sample, number>) => { const ss = [...m.keys()]; return auc(ss.map(s => m.get(s)!), ss.map(s => s.y)); };

function train() {
  const t0 = Date.now();
  const { samples, refs, groups, labels, poolSize } = collect();
  const st = standardize(samples.map(s => s.x));
  const K = groups.length;
  const cv = LAMBDAS.map(l => ({ lambda: l, auc: aucOf(crossVal(samples, K, l, st)) }));
  const best = Math.max(...cv.map(c => c.auc));
  const lambda = Math.max(...cv.filter(c => c.auc >= best - 0.005).map(c => c.lambda));
  const f = fit(samples, lambda, st);
  const m = toModel(f, st, lambda);
  const refScores = refs.map(r => scoreWorld(r.w, m));
  m.threshold = pct(refScores.flatMap(r => r.windows.map(w => w.score)), 0.9);
  m.refMeanP90 = pct(refScores.map(r => r.mean), 0.9);
  m.trained = new Date().toISOString().slice(0, 10);
  const n = (k: string) => samples.filter(s => s.kind === k).length;
  m.data = { refs: refs.length, refGroups: K, refWindows: n('ref'), genSeeds: 100, genPool: poolSize, genWindows: n('gen'), labels: labels.length,
    labelWindows: n('label'), labelWeight: LABEL_W, cv: cv.map(c => ({ lambda: c.lambda, auc: +c.auc.toFixed(4) })), blacklist: FEATURES.filter(x => !featIds.includes(x.id)).map(x => x.id) };
  writeFileSync(MODEL_FILE, JSON.stringify(m, null, 1));
  console.log(`judge.json: λ=${lambda}, CV AUC ${cv.map(c => `${c.lambda}:${c.auc.toFixed(3)}`).join(' ')}; threshold ${m.threshold.toFixed(3)}, refMeanP90 ${m.refMeanP90.toFixed(3)}; ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  console.log(`nonzero: ${m.w.map((w, j) => [featIds[j], w] as const).filter(([, w]) => w).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([id, w]) => `${id} ${w.toFixed(2)}`).join(', ')}`);
}

function evaluate() {
  const m = JSON.parse(readFileSync(MODEL_FILE, 'utf8')) as JudgeModel;
  if (m.trained === 'untrained') throw new Error('train first');
  const { samples, refs, groups, labels } = collect();
  const st = { mean: m.mean, std: m.std };
  const K = groups.length;
  const lines: string[] = [];
  const P = (s = '') => lines.push(s);
  // 1. cross-validated AUC and validation AUC
  const oof = crossVal(samples, K, m.lambda, st);
  const cvAuc = aucOf(oof);
  const refOof = [...oof].filter(([s]) => s.kind === 'ref').map(([, p]) => p);
  const valScores: number[] = [];
  for (const s of SEEDS.slice(100)) valScores.push(...scoreWorld(genWorld(s), m).windows.map(w => w.score));
  const valAuc = auc([...refOof, ...valScores], [...refOof.map(() => 0), ...valScores.map(() => 1)]);
  // 2. label pair accuracy, leave one label seed out (region score = highest of its windows)
  // region score: highest (the design) and mean (no size bias: big regions have more windows, hence a higher max)
  const regionScore = (l: (typeof labels)[number], mm: JudgeModel) => {
    const w = alignScene(l.scene), wins = windows(w), r = scoreWorld(w, mm);
    const sc = coveredWindows(l.rect, wins).map(i => r.windows[i].score);
    return { max: sc.length ? Math.max(...sc) : NaN, mean: sc.length ? sc.reduce((a, b) => a + b, 0) / sc.length : NaN, n: sc.length };
  };
  const seeds = [...new Set(labels.map(l => l.seed))];
  type RS = ReturnType<typeof regionScore>;
  const loso = new Map<(typeof labels)[number], RS>(), insample = new Map<(typeof labels)[number], RS>();
  for (const s of seeds) {
    const mm = toModel(fit(samples.filter(x => x.group !== `label:${s}`), m.lambda, st), st, m.lambda);
    for (const l of labels.filter(l => l.seed === s)) loso.set(l, regionScore(l, mm));
  }
  for (const l of labels) insample.set(l, regionScore(l, m));
  const pairAcc = (sc: Map<(typeof labels)[number], RS>, k: 'max' | 'mean') => {
    let ok = 0, n = 0;
    for (const b of labels.filter(l => l.verdict === 'bad')) for (const g of labels.filter(l => l.verdict === 'good')) {
      n++; const d = sc.get(b)![k] - sc.get(g)![k]; ok += d > 0 ? 1 : d === 0 ? 0.5 : 0;
    }
    return { acc: n ? ok / n : NaN, n };
  };
  const pl = pairAcc(loso, 'max'), pi = pairAcc(insample, 'max'), plm = pairAcc(loso, 'mean'), pim = pairAcc(insample, 'mean');

  P('# 评判器（阶段 6）');
  P();
  P('> 由 `app/scripts/judge.ts eval` 生成，不要手改。设计见 `docs/superpowers/specs/2026-11-03-stage6-judge-design.md`。');
  P();
  P(`模型训练于 ${m.trained}：L1 逻辑回归，λ = ${m.lambda}，${m.features.length} 个特征（${m.w.filter(w => w).length} 个非零）。`);
  const d = m.data as Record<string, unknown>;
  P(`数据：参考图 ${d.refs} 张（${d.refGroups} 个近重复组）共 ${d.refWindows} 个窗口；生成图前 100 个回归种子抽 ${d.genWindows} 个窗口（共 ${d.genPool} 个）；标注 ${d.labels} 条，覆盖 ${d.labelWindows} 个窗口（权重 ${d.labelWeight}）。`);
  P(`怪异分阈值（参考图窗口得分 90 百分位）：**${m.threshold.toFixed(3)}**；参考图整图平均分 90 百分位：${m.refMeanP90.toFixed(3)}。`);
  P();
  P('## 1. 区分度');
  P();
  P('| 指标 | 值 |');
  P('|---|---|');
  P(`| 留一组交叉验证 AUC（参考图按近重复组留出，生成图按种子分到各折） | ${cvAuc.toFixed(3)} |`);
  P(`| 验证集 AUC（后 100 个种子的全部窗口 vs 参考图留一组得分） | ${valAuc.toFixed(3)} |`);
  P(`| 各 λ 的交叉验证 AUC | ${(d.cv as { lambda: number; auc: number }[]).map(c => `${c.lambda}: ${c.auc.toFixed(3)}`).join('，')} |`);
  P();
  const order = m.w.map((w, j) => j).filter(j => m.w[j]).sort((a, b) => Math.abs(m.w[b]) - Math.abs(m.w[a]));
  if (cvAuc > 0.97) {
    P(`**报警：AUC = ${cvAuc.toFixed(3)} > 0.97。** 区分得太好，多半是两边“视力”不同（统计方式不同），而不是生成图怪。贡献最大的特征（请优先排查）：`);
    for (const j of order.slice(0, 5)) P(`- \`${m.features[j]}\` ${FEATURES.find(f => f.id === m.features[j])!.name}（权重 ${m.w[j].toFixed(2)}）`);
    P();
  }
  P('## 2. 标注成对准确率');
  P();
  P(`每一对（坏区域，好区域）里坏的得分更高的比例。共 ${pl.n} 对（${labels.filter(l => l.verdict === 'bad').length} 坏 × ${labels.filter(l => l.verdict === 'good').length} 好）。区域得分有两种算法：设计里的“对应窗口的最高分”，以及“平均分”（大区域窗口多，最高分天然偏高，好标注里的停车场、大花园都是大区域）。`);
  P();
  P('| 区域得分 | 按标注种子留一（这个种子的标注不参与训练；目标 ≥ 0.7） | 训练集上（参考） |');
  P('|---|---|---|');
  P(`| 最高分 | **${pl.acc.toFixed(3)}** | ${pi.acc.toFixed(3)} |`);
  P(`| 平均分 | **${plm.acc.toFixed(3)}** | ${pim.acc.toFixed(3)} |`);
  P();
  P('| 标注 | 好 / 坏 | 窗口数 | 留一：最高 / 平均 | 训练集：最高 / 平均 |');
  P('|---|---|---|---|---|');
  for (const l of labels) { const a = loso.get(l)!, b = insample.get(l)!; P(`| seed${l.seed} ${l.id} | ${l.verdict === 'good' ? '好' : '坏'} | ${a.n} | ${a.max.toFixed(3)} / ${a.mean.toFixed(3)} | ${b.max.toFixed(3)} / ${b.mean.toFixed(3)} |`); }
  P();
  P('## 3. 学到的规律（权重表，等用户核对）');
  P();
  P('按 |权重| 排序，只列非零的。权重 > 0：值越高越像生成图（越“怪”）。例子是该特征标准化值最大的参考图窗口和生成图窗口（窗口左上角的格坐标）。不同意的特征可以登记到 `app/src/gen/judge/blacklist.json`，重训后不再使用。');
  P();
  P('| # | 特征 | 权重 | 规律 | 参考图例子 | 生成图例子 |');
  P('|---|---|---|---|---|---|');
  const ex = (kind: 'ref' | 'gen', j: number) => {
    const s = samples.filter(x => x.kind === kind).sort((a, b) => b.x[j] - a.x[j])[0];
    return s ? `${s.src} (${s.win.c0},${s.win.r0}) 值 ${s.x[j].toFixed(2)}` : '-';
  };
  order.forEach((j, i) => {
    const f = FEATURES.find(f => f.id === m.features[j])!;
    const rule = m.w[j] > 0 ? `生成图比参考图更常见：${f.high}` : `参考图比生成图更常见：${f.high}（生成图偏少）`;
    P(`| ${i + 1} | \`${f.id}\` ${f.name} | ${m.w[j].toFixed(2)} | ${rule} | ${ex('ref', j)} | ${ex('gen', j)} |`);
  });
  const zero = m.features.filter((_, j) => !m.w[j]);
  if (zero.length) { P(); P(`权重为 0（L1 去掉）：${zero.map(id => `\`${id}\``).join('、')}。`); }
  if ((d.blacklist as string[]).length) { P(); P(`黑名单（不参与训练）：${(d.blacklist as string[]).map(id => `\`${id}\``).join('、')}。`); }
  P();
  P('## 4. 热力图');
  P();
  P('红色越深越怪（每个像素取覆盖它的窗口里的最高分），黄框 = 超过阈值的窗口。');
  P();
  const out = join(ROOT, 'docs', 'reports', 'judge'), tmp = join(ROOT, 'work', 'judge');
  mkdirSync(out, { recursive: true }); mkdirSync(tmp, { recursive: true });
  const heat = (name: string, h: object) => {
    const hj = join(tmp, `${name}.heat.json`), png = join(out, `heat_${name}.png`);
    writeFileSync(hj, JSON.stringify(h));
    execFileSync('uv', ['run', 'python', 'heatmap.py', hj, png], { cwd: join(ROOT, 'tools'), stdio: 'inherit' });
    return `heat_${name}.png`;
  };
  for (const s of SEEDS.slice(0, 3)) {
    const sc = generateBase(s, withDefaults({}));
    const scenePath = join(tmp, `seed${s}.json`);
    writeFileSync(scenePath, JSON.stringify(sc));
    const r = scoreWorld(alignScene(sc), m);
    const f = heat(`seed${s}`, { src: 'gen', scene: scenePath, threshold: m.threshold, windows: r.windows });
    P(`- 生成图 seed${s}（修复前）：平均 ${r.mean.toFixed(3)}，最高 ${r.max.toFixed(3)}`);
    P(`  ![](judge/${f})`);
  }
  for (const name of ['market_on_street', 'suburb_neighborhood_1']) {
    const ref = refs.find(r => r.name === name); if (!ref) continue;
    const r = scoreWorld(ref.w, m);
    const f = heat(name, { src: 'ref', ref: name, threshold: m.threshold, windows: r.windows });
    P(`- 参考图 ${name}：平均 ${r.mean.toFixed(3)}，最高 ${r.max.toFixed(3)}`);
    P(`  ![](judge/${f})`);
  }
  P();
  P('## 5. 各参考图的整图平均分');
  P();
  P('| 参考图 | 平均 | 最高 | 超阈值窗口 |');
  P('|---|---|---|---|');
  for (const r of refs) { const s = scoreWorld(r.w, m); P(`| ${r.name} | ${s.mean.toFixed(3)} | ${s.max.toFixed(3)} | ${s.windows.filter(w => w.score > m.threshold).length} / ${s.windows.length} |`); }
  writeFileSync(join(ROOT, 'docs', 'reports', 'JUDGE.md'), lines.join('\n') + '\n');
  console.log(`JUDGE.md: CV AUC ${cvAuc.toFixed(3)}, validation AUC ${valAuc.toFixed(3)}, label pairs max ${pl.acc.toFixed(3)} / mean ${plm.acc.toFixed(3)} (in-sample ${pi.acc.toFixed(3)} / ${pim.acc.toFixed(3)})`);
}

const cmd = process.argv[2];
if (cmd === 'train') train();
else if (cmd === 'eval') evaluate();
else { console.error('usage: judge.ts train | eval'); process.exit(2); }
