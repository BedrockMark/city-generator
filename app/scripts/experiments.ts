// Stage 7: `npx tsx scripts/experiments.ts report` — promotion / retirement evidence per registered experiment.
// Writes src/gen/data/experiments.json ({ [id]: ExpEvidence }, read by the viewer's 实验 menu). Executes nothing.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPERIMENTS } from '../src/gen/exp';
import { loadChoiceComparisons } from '../src/gen/learn/data';
import { expEvidence, type ExpEvidence } from '../src/gen/learn/expreport';
import { labelRegion } from '../src/gen/judge/labelset';
import { loadLabels, LABEL_DIR } from './labeltests';
import type { Scene } from '../src/gen/types';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'src', 'gen', 'data', 'experiments.json');

function report() {
  const scenes = new Map<string, Scene>();
  const labels = loadLabels().map(({ file, label: l }) => {
    const p = join(LABEL_DIR, `v${l.version}`, l.scene);
    if (!scenes.has(p)) { try { scenes.set(p, JSON.parse(readFileSync(p, 'utf8')) as Scene); } catch { /* scene missing */ } }
    const scene = scenes.get(p);
    return scene ? { verdict: l.verdict, rect: labelRegion(l, scene), scene } : null;
  }).filter(x => x !== null);
  const { cs } = loadChoiceComparisons();
  const out: Record<string, ExpEvidence> = {};
  const rows = ['| 编号 | 标题 | 好 / 坏 | A/B 胜 / 负 | 好的比例 | 建议 |', '|---|---|---|---|---|---|'];
  for (const e of EXPERIMENTS.filter(x => x.status === 'experimental')) {
    const ev = out[e.id] = expEvidence(e.id, labels, cs);
    rows.push(`| ${e.id} | ${e.title} | ${ev.good} / ${ev.bad} | ${ev.abWin} / ${ev.abLose} | ${ev.goodShare === null ? '—' : Math.round(ev.goodShare * 100) + '%'} | ${ev.suggestion} |`);
  }
  writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  console.log(rows.join('\n'));
  console.log('\n规则：证据 ≥ 8 条且好的比例 ≥ 70% 建议转正；≤ 30% 建议废弃；否则继续观察。');
  console.log('以上只是建议，不会自动执行：转正 / 废弃要你确认后，手动修改 app/src/gen/exp.ts 和 docs/EXPERIMENTS.md。');
}

const cmd = process.argv[2];
if (cmd === 'report') report();
else { console.error('用法：npx tsx scripts/experiments.ts report'); process.exit(1); }
