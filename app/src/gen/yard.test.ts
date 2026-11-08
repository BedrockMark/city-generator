import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from './rng';
import { joinGardens } from './yard';
import { generate } from './generate';
import type { Layout } from './layout';

/** a yard with no sidewalk nearby */
const L = { cls: Array.from({ length: 50 }, () => Array<string>(50).fill('lot')) } as unknown as Layout;

type R = { x: number; y: number; w: number; h: number };
/** own paths by rectangle */
const owns = (...m: [R, { vertical: boolean; at: number }][]) => (rc: R) => m.find(([r]) => r === rc)![1];

test("touching gardens whose paths both cross the shared edge: one straight path, the bigger one moves as little as it must", () => {
  const a = { x: 23, y: 21, w: 13, h: 9 }, b = { x: 13, y: 23, w: 10, h: 4 };   // seed 716771
  for (const at of [24, 25, 26]) {
    const j = joinGardens(L, [{ rc: a }, { rc: b }], owns([a, { vertical: false, at }], [b, { vertical: false, at: 24 }]), new Rng('j'))!;
    assert.deepEqual(j.pa, { vertical: false, at: Math.min(at, 25) });
    assert.deepEqual(j.pb, j.pa);
    assert.equal(j.link, undefined, 'touching: nothing to link');
  }
  const own = owns([a, { vertical: false, at: 25 }]);
  assert.equal(joinGardens(L, [{ rc: a }, { rc: { x: 40, y: 21, w: 5, h: 5 } }], own, new Rng('x')), null, '4 cells apart: not joined');
  assert.equal(joinGardens(L, [{ rc: a }, { rc: { x: 13, y: 28, w: 10, h: 4 } }], own, new Rng('x')), null, 'no room for a path across the shared edge');
});

test("gardens whose paths run along the shared edge keep them; the link joins them (T junctions)", () => {
  const a = { x: 15, y: 22, w: 26, h: 6 }, b = { x: 37, y: 15, w: 4, h: 7 };   // seed 5: b sits on a's east end
  const j = joinGardens(L, [{ rc: a }, { rc: b }], owns([a, { vertical: false, at: 25 }], [b, { vertical: false, at: 18 }]), new Rng('s'))!;
  assert.deepEqual(j.pa, { vertical: false, at: 25 });
  assert.deepEqual(j.pb, { vertical: false, at: 18 });
  assert.ok(j.link!.x >= 38 && j.link!.x <= 39);
  assert.deepEqual({ ...j.link, x: 0 }, { x: 0, y: 19, w: 1, h: 6 }, "from b's path down to a's");
});

test('gardens one column apart are linked across the gap (seed 161781)', () => {
  const a = { x: 30, y: 21, w: 15, h: 5 }, b = { x: 25, y: 15, w: 4, h: 17 };
  const own = owns([a, { vertical: false, at: 22 }], [b, { vertical: true, at: 27 }]);
  const j = joinGardens(L, [{ rc: a }, { rc: b }], own, new Rng('g'))!;
  assert.deepEqual(j.pa, { vertical: false, at: 22 }, 'a crosses toward b: its line');
  assert.deepEqual(j.pb, { vertical: true, at: 27 }, 'b keeps its north-south path');
  assert.deepEqual(j.link, { x: 28, y: 22, w: 2, h: 1 }, "from b's path across the gap to a's edge");
  assert.equal(joinGardens(L, [{ rc: a }, { rc: b }], own, new Rng('g'), (x) => x !== 29), null, 'gap not free yard: left apart');
});

test('touching gardens are left apart when C20 would remove the link (sidewalk right beside it)', () => {
  const W = { cls: Array.from({ length: 50 }, (_, y) => Array.from({ length: 50 }, (_, x) => (x === 41 ? 'walk' : 'lot'))) } as unknown as Layout;
  const a = { x: 15, y: 22, w: 26, h: 6 }, b = { x: 37, y: 15, w: 4, h: 7 };
  assert.equal(joinGardens(W, [{ rc: a }, { rc: b }], owns([a, { vertical: false, at: 25 }], [b, { vertical: false, at: 18 }]), new Rng('s')), null);
});

test('exp-06 is adopted: always on, untagged (seed 716771, novelty 0.7: the two gardens of one yard space are one)', () => {
  const on = generate('716771', { novelty: 0.7 });
  const paths = on.zones!.filter(z => z.kind === 'path' && /^garden/.test(z.gid ?? ''));
  assert.ok(paths.length >= 2);
  assert.ok(paths.some((p, i) => paths.some((q, j) => i !== j && p.gid === q.gid)), 'a garden with two paths (its halves)');
  assert.ok(paths.every(z => z.exp === undefined), 'adopted: untagged');
});
