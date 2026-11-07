import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from './rng';
import { joinGardens } from './yard';
import { expEnabled, withDefaults } from './exp';
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

test('exp-06 is adopted (0.7.5): always on, untagged; as an experiment (0.7.4) off left the picture, on changed only the yard (seed 716771)', () => {
  assert.equal(expEnabled(withDefaults({ experiments: false }), 'exp-06'), true);
  assert.equal(expEnabled(withDefaults({ asOf: '0.7.4' }), 'exp-06'), false);
  const o = { judgeRepair: false, novelty: 0.7, asOf: '0.7.4', exp: { 'exp-05': true } };
  const off = generate('716771', o as never), off2 = generate('716771', { ...o, exp: { ...o.exp, 'exp-06': false } } as never);
  assert.equal(JSON.stringify(off.objects), JSON.stringify(off2.objects));
  const on = generate('716771', { ...o, exp: { ...o.exp, 'exp-06': true } } as never);
  const paths = on.zones!.filter(z => z.kind === 'path' && /^garden/.test(z.gid ?? ''));
  assert.equal(paths.length, 2);
  assert.equal(paths[0].gid, paths[1].gid, 'one garden');
  assert.equal(paths[0].rect.y0, paths[1].rect.y0, 'one path row');
  assert.ok(paths.every(z => z.exp === undefined), 'adopted: untagged');
  // the yard may change around the gardens (a strip tree loses its spot to a garden tree), nothing else does
  const rest = (sc: typeof on) => JSON.stringify(sc.objects.filter(x => !/^yard\//.test(x.stream ?? '')).map(x => [x.key, x.x, x.y]));
  assert.equal(rest(on), rest(off));
});
