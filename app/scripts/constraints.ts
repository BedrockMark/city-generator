// Stage 5: measure the constraint list on the regression seeds and on the analysed references.
//   npx tsx scripts/constraints.ts gen [n]      violations per constraint on the first n regression seeds (default all),
//                                               and what the draft repairs would prune (preview)
//   npx tsx scripts/constraints.ts refs         the same constraints on work/refworld/*.json (tools/export_refworld.py)
//   npx tsx scripts/constraints.ts doc [n]      both, written to docs/reports/CONSTRAINTS.md (the list the user confirms)
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, VERSION } from '../src/gen/generate';
import { CONSTRAINTS, evaluate, makeCtx, subjects, appliesToRefs, type Constraint, type Rule, type Sel } from '../src/gen/rational/constraints';
import { worldFromScene, worldFromRef, type RefWorldJSON } from '../src/gen/rational/world';
import { SEEDS } from './seeds';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..');

interface Tally { subj: number; viol: number; scenes: number; examples: string[] }
const tally = () => Object.fromEntries(CONSTRAINTS.map(c => [c.id, { subj: 0, viol: 0, scenes: 0, examples: [] as string[] }])) as Record<string, Tally>;

export function genStats(seeds: string[]) {
  const t = tally();
  const pr: Record<string, number> = {};
  let prunedObjs = 0, downgraded = 0, objs = 0;
  const t0 = Date.now();
  for (const s of seeds) {
    // judged as generated (no repair at all), so the numbers do not depend on which constraints are active
    const sc = generate(s, { prune: false, pruneDraft: false });
    objs += sc.objects.length;
    const cx = makeCtx(worldFromScene(sc));
    for (const c of CONSTRAINTS) {
      const vs = evaluate(c, cx), T = t[c.id];
      T.subj += subjects(c, cx); T.viol += vs.length; if (vs.length) T.scenes++;
      for (const v of vs) if (T.examples.length < 3) T.examples.push(`seed ${s}：${v.msg}`);
    }
    const p = generate(s, { prune: true, pruneDraft: true }).audit!;
    prunedObjs += p.pruned.length; downgraded += p.downgraded.length;
    for (const x of p.pruned) pr[x.c] = (pr[x.c] ?? 0) + 1;
  }
  return { t, pr, prunedObjs, downgraded, objs, n: seeds.length, ms: (Date.now() - t0) / seeds.length / 2 };
}

export function refStats() {
  const dir = join(ROOT, 'work', 'refworld');
  const t = tally();
  const files = readdirSync(dir).filter(f => f.endsWith('.json'));
  for (const f of files) {
    const j = JSON.parse(readFileSync(join(dir, f), 'utf8')) as RefWorldJSON;
    const w = worldFromRef(j);
    // every detection blocks the way, but only confident detections are judged
    const cx = makeCtx(w);
    const judged = { ...cx, w: { ...w, objs: w.objs.filter(o => o.conf !== 'low') } };
    for (const c of CONSTRAINTS.filter(appliesToRefs)) {
      const vs = evaluate(c, cx).filter(v => cx.byId.get(v.target)?.conf !== 'low'), T = t[c.id];
      T.subj += subjects(c, judged); T.viol += vs.length; if (vs.length) T.scenes++;
      for (const v of vs) if (T.examples.length < 3) T.examples.push(`${j.name}：${v.msg}`);
    }
  }
  return { t, n: files.length };
}

const pct = (a: number, b: number) => b ? `${(100 * (1 - a / b)).toFixed(1)}%` : '—';

const selText = (s: Sel) =>
  [s.person ? (s.sit ? '坐着的人' : s.sit === false ? '站着的人' : '人') : '', s.cls?.join('/') ?? '', s.key ? `精灵名 ~ /${s.key}/` : '', s.group ? `${s.group.join('/')} 小组的物件` : '', s.notGroup ? `（不含 ${s.notGroup.join('/')} 小组）` : ''].filter(Boolean).join(' ');

function ruleText(r: Rule): string {
  switch (r.kind) {
    case 'door-open': return '每扇门正前方 24×14px 内有能站人的格子';
    case 'door-street': return '门前能站人的区域连到人行道、地图边缘或别的楼的门';
    case 'leads-somewhere': return `${r.zones.join('/')} 除街道外，至少连到一块 ${r.to.join('/')}，或者有门开向它`;
    case 'zone-reachable': return `${r.zones.join('/')} 至少有一处能站人的地方连到街道 / 地图边缘 / 门`;
    case 'reachable': return `${selText(r.who)} 四周 12px 内有能站人的地方，且连到街道 / 地图边缘 / 门`;
    case 'front-open': return `${selText(r.who)} 面朝方向 ${r.depth}px 内被墙 / 物件挡住的比例 ≤ 50%`;
    case 'near': return `${selText(r.who)} 离 ${r.to.map(x => typeof x === 'string' ? x : 'cls' in x ? x.cls.join('/') : 'key' in x ? `/${x.key}/` : `区域 ${x.zone.join('/')}`).join(' 或 ')} ≤ ${r.within}px`;
    case 'on-ground': return `${selText(r.who)} 占地 ≥ ${r.frac * 100}% 在 ${r.ground.join('/')} 上`;
    case 'group-complete': return `小组 ${r.group} 同时包含 ${r.need.map(n => `/${n.key}/`).join(' 和 ')}`;
    case 'not-inside': return `${selText(r.who)} 的脚不在建筑碰撞体积或其他物件占地里`;
    case 'keep-clear': return `禁放区 ${r.zones.join('/')} 里没有别的小组的物件${r.exempt ? `（${r.exempt.join('/')} 小组${r.exemptReason ? `和原因含“${r.exemptReason}”的物件` : ''}除外）` : ''}`;
    case 'anchor': return '锚点是物件的，被锚的物件仍然存在';
    case 'banned': return `不出现 ${selText(r.who)}`;
    case 'not-near': return `${selText(r.who)} 和 ${r.to.map(x => typeof x === 'string' ? (x === 'door-front' ? '门前（门两侧 16px、向下 64px）' : x) : 'cls' in x ? x.cls.join('/') : 'key' in x ? `/${x.key}/` : `区域 ${x.zone.join('/')}${x.below ? `（含前方 ${x.below}px）` : ''}`).join(' 或 ')} 相距 > ${r.within}px${r.whole ? '（违规时整组删除）' : ''}`;
    case 'door-path': return `门到最近的人行道 / 小路 / 广场的路线（优先铺地、少转弯，≤ ${r.depth} 格）上没有物件、不是草坪`;
    case 'path-ends': return '花园小路两头通到人行道、另一条小路、门或空地；穿到楼后的段铺好、没有杂物';
    case 'path-redundant': return `花园小路沿线每一处离人行道都 ≤ ${r.within}px 时算多余`;
    case 'mouth-gap': return `${r.zone} 和 ${r.from} 至少相隔 ${r.min}px`;
    case 'occludes-door': return '门前（脚更靠南、画在楼前面）的物件不盖住门';
  }
}

const FIX: Record<Constraint['fix'], string> = { remove: '删除', downgrade: '降级', report: '只报告' };

function doc(n: number) {
  const g = genStats(SEEDS.slice(0, n)), r = refStats();
  const L: string[] = [];
  L.push('# 约束清单（阶段 5）', '',
    '> 由 `cd app && npx tsx scripts/constraints.ts doc` 从 `app/src/gen/rational/constraints.ts` 生成，不要手改。',
    `> 生成结果：${g.n} 个回归种子（v${VERSION}，不做任何修复时）；参考图：${r.n} 张 street 类参考图（只判高置信度物件）。`, '',
    '状态：草案 = 只测量和显示，不修复；生效 = 打开剪枝时（默认打开）按“修复”一栏处理；关闭 = 不检查。', '',
    '| 编号 | 约束 | 判定 | 严重度 | 修复 | 状态 | 生成：通过率（违规 / 对象数，涉及种子） | 参考图：通过率（违规 / 对象数） |',
    '|---|---|---|---|---|---|---|---|');
  for (const c of CONSTRAINTS) {
    const G = g.t[c.id], R = r.t[c.id];
    L.push(`| ${c.id} | **${c.title}** | ${ruleText(c.rule)} | ${c.severity === 'hard' ? '硬' : '软'} | ${FIX[c.fix]}${c.downgrade ? `（${c.downgrade === 'lawn' ? '草坪' : '只留植物'}）` : ''} | ${{ draft: '草案', active: '生效', off: '关闭' }[c.status]} | ${pct(G.viol, G.subj)}（${G.viol} / ${G.subj}，${G.scenes} 个种子） | ${appliesToRefs(c) ? `${pct(R.viol, R.subj)}（${R.viol} / ${R.subj}）` : '不适用'} |`);
  }
  L.push('', '## 依据与例子', '');
  for (const c of CONSTRAINTS) {
    L.push(`### ${c.id} ${c.title}`, `- 依据：${c.why}`);
    for (const e of g.t[c.id].examples) L.push(`- 生成例：${e}`);
    for (const e of r.t[c.id].examples) L.push(`- 参考图例：${e}`);
    L.push('');
  }
  L.push('## 草案修复预览', '',
    `把全部草案当作生效时（\`pruneDraft\`），${g.n} 个种子共删除 ${g.prunedObjs} 个物件（占全部物件的 ${(100 * g.prunedObjs / g.objs).toFixed(2)}%），降级 ${g.downgraded} 块区域。按约束：${Object.entries(g.pr).sort().map(([k, v]) => `${k} ${v}`).join('，') || '无'}。`, '');
  writeFileSync(join(ROOT, 'docs', 'reports', 'CONSTRAINTS.md'), L.join('\n'));
  console.log(`docs/reports/CONSTRAINTS.md written (${g.n} seeds, ${g.ms.toFixed(0)} ms/scene, ${r.n} refs)`);
}

const [cmd, a] = process.argv.slice(2);
if (cmd === 'gen') {
  const g = genStats(SEEDS.slice(0, a ? +a : SEEDS.length));
  for (const c of CONSTRAINTS) { const T = g.t[c.id]; console.log(`${c.id} ${c.title.padEnd(16)} ${String(T.viol).padStart(4)} / ${String(T.subj).padStart(5)}  (${T.scenes} seeds)  pass ${pct(T.viol, T.subj)}`); }
  console.log(`preview (drafts repairing): pruned ${g.prunedObjs} of ${g.objs} objects, downgraded ${g.downgraded} zones;`, g.pr, `${g.ms.toFixed(0)} ms/scene`);
} else if (cmd === 'refs') {
  const r = refStats();
  for (const c of CONSTRAINTS.filter(appliesToRefs)) { const T = r.t[c.id]; console.log(`${c.id} ${c.title.padEnd(16)} ${String(T.viol).padStart(4)} / ${String(T.subj).padStart(5)}  (${T.scenes} refs)  pass ${pct(T.viol, T.subj)}`); for (const e of T.examples) console.log('    ', e); }
} else if (cmd === 'doc') doc(a ? +a : SEEDS.length);
else { console.error('usage: constraints.ts gen [n] | refs | doc [n]'); process.exit(2); }
