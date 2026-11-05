// A/B question check (stage 7): one question per seed (the first n regression seeds; every 5th a big question).
// Each change is regenerated alone: its diff must lie inside its own box and the box must not overlap another box;
// B's diff must lie inside the union of the boxes. Exit code 1 when anything overflows.
//   npx tsx scripts/abcheck.ts [n=50]
import { generateBase } from '../src/gen/generate';
import { withDefaults } from '../src/gen/exp';
import { forceKey } from '../src/gen/rng';
import type { PxRect } from '../src/gen/types';
import { makeQuestion, statsFrom } from '../src/gen/learn/ab';
import { diffItems, overlaps } from '../src/gen/learn/diff';
import { SEEDS } from './seeds';

const n = Number(process.argv[2] ?? 50);
const inside = (r: PxRect, o: PxRect) => r.x0 >= o.x0 && r.y0 >= o.y0 && r.x1 <= o.x1 && r.y1 <= o.y1;
const stats = statsFrom([], []), options = withDefaults();
let m = 0, over = 0, ms = 0, empty = 0;
SEEDS.slice(0, n).forEach((seed, j) => {
  const { q, a, b } = makeQuestion({ seed, options, stats, big: (j + 1) % 5 === 0 });
  const bad: string[] = [];
  q.changes.forEach((c, i) => {
    const d = diffItems(a, generateBase(seed, { ...q.options, force: { [forceKey(c.stream, c.label, c.k)]: c.b } }));
    const out = d.filter(x => !inside(x.rect, c.rect)).length;
    const hit = q.changes.some((o, k) => k !== i && overlaps(o.rect, c.rect));
    if (out || hit) { over++; bad.push(`${c.label}${out ? ` ${out} outside` : ''}${hit ? ' overlaps' : ''}`); }
  });
  const bOut = diffItems(a, b).filter(x => !q.changes.some(c => inside(x.rect, c.rect))).length;
  if (bOut) { over++; bad.push(`B: ${bOut} outside`); }
  m += q.changes.length; ms += q.ms; if (!q.changes.length) empty++;
  console.log(`seed ${seed}${q.big ? ' big' : ''}: ${q.changes.length} 处 (${q.changes.map(c => c.label).join(', ')}), 试 ${q.tried}, ${(q.ms / 1000).toFixed(1)} 秒${bad.length ? ' 溢出: ' + bad.join('; ') : ''}`);
});
const N = Math.min(n, SEEDS.length);
console.log(`${N} 题、${m} 处改动、溢出 ${over} 处、平均每题 ${(m / N).toFixed(1)} 处、平均 ${(ms / N / 1000).toFixed(1)} 秒（${empty} 题出不了）`);
process.exit(over ? 1 : 0);
