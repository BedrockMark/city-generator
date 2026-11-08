import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng, Trace, alternatives, type Adjust } from './rng';

const draw = (r: Rng, n = 5) => Array.from({ length: n }, () => r.next());

test('a fork draws from seed/label', () => {
  const r = new Rng('7', new Trace('7')).fork('a').fork('b');
  assert.deepEqual(draw(r), draw(new Rng('7/a/b')));
  assert.equal(r.stream, 'a/b');
});

test('trace keys use logical paths', () => {
  const t = new Trace('7');
  const r = new Rng('7', t).fork('a').fork('b', { k: 1 });
  r.choose('x', {}, [1, 2]);
  assert.deepEqual(Object.keys(t.streams), ['a/b']);
  assert.equal((t.decisions[0] as { s: string }).s, 'a/b');
});

// ---- stage 7: decision identity, adjust hook ----
type D = { s: string; label: string; i: number; pick: string; m?: Record<string, number>; kind?: string };
const decs = (t: Trace) => t.decisions as unknown as D[];

test('decisions carry their per-stream index', () => {
  const t = new Trace('7'); const root = new Rng('7', t);
  const a = root.fork('a'), b = root.fork('b');
  a.choose('x', {}, [1, 2]); a.choose('x', {}, [1, 2]); a.choose('y', {}, [1, 2]); b.choose('x', {}, [1, 2]);
  assert.deepEqual(decs(t).map(d => [d.s, d.label, d.i]), [['a', 'x', 0], ['a', 'x', 1], ['a', 'y', 0], ['b', 'x', 0]]);
});

test('k counts rejected calls', () => {
  const t = new Trace('7'); const r = new Rng('7', t).fork('a');
  const m = r.mark(); r.choose('x', {}, [1, 2]); r.reject(m, 't'); r.choose('x', {}, [1, 2]);
  assert.equal(decs(t).length, 1); assert.equal(decs(t)[0].i, 1);
});

const run = (seed: string, adjust?: Adjust) => {
  const t = new Trace(seed, adjust); const r = new Rng(seed, t).fork('a');
  const out = [r.choose('x', {}, ['a', 'b', 'c']), r.choose('w', {}, { weights: [['a', 1], ['b', 3]] }), r.choose('p', {}, { p: 0.3 }), r.count('n', {}, 2, 7), r.next()];
  return { out, t };
};

test('adjust null keeps the original draw', () => {
  for (let s = 0; s < 50; s++) {
    const a = run(String(s), () => null), b = run(String(s));
    assert.deepEqual(a.out, b.out); assert.deepEqual(a.t.toJSON(), b.t.toJSON());
  }
});

test('adjust multipliers shift frequencies', () => {
  const adj: Adjust = (label, _c, opts) => label === 'x' ? { w: [4, 1], m: { a: 4 } } : label === 'p' ? { w: [4, 1] } : null;
  let na = 0, nt = 0; const N = 2000;
  for (let s = 0; s < N; s++) {
    const t = new Trace(String(s), adj); const r = new Rng(String(s), t).fork('a');
    if (r.choose('x', {}, ['a', 'b']) === 'a') na++;
    if (r.choose('p', {}, { p: 0.5 })) nt++;
    if (s === 0) assert.deepEqual(decs(t)[0].m, { a: 4 });
  }
  assert.ok(na / N > 0.75 && na / N < 0.85, `a ${na / N}`);
  assert.ok(nt / N > 0.75 && nt / N < 0.85, `true ${nt / N}`);
});

test('novel picks are collected only when the novelty changed them', () => {
  // w0 = [1, 1] (no novelty): seeds where the plain draw already gives 'b' are not novel
  let changed = 0, kept = 0;
  for (let s = 0; s < 200; s++) {
    const plain = new Rng(String(s), new Trace(String(s))).fork('a').choose('x', {}, ['a', 'b']);
    const t = new Trace(String(s), () => ({ w: [1, 9], w0: [1, 1], novel: ['b'] }));
    const v = new Rng(String(s), t).fork('a').choose('x', {}, ['a', 'b']);
    if (v === 'b' && plain === 'a') { changed++; assert.deepEqual(t.novel, ['a|b'], `seed ${s}`); }
    else { kept++; assert.deepEqual(t.novel, [], `seed ${s}: novelty did not change the pick`); }
  }
  assert.ok(changed > 50 && kept > 50, `changed ${changed} kept ${kept}`);
});

test('novel picks of a rejected proposal are dropped', () => {
  const t = new Trace('7', () => ({ w: [0, 1], w0: [1, 0], novel: ['b'] }));
  const r = new Rng('7', t).fork('a');
  r.choose('x', {}, ['a', 'b']);
  const m = r.mark(); r.choose('x', {}, ['a', 'b']); r.choose('x', {}, ['a', 'b']); r.reject(m, 'p');
  r.choose('x', {}, ['a', 'b']);
  assert.deepEqual(t.novel, ['a|b', 'a|b']);
  assert.deepEqual(t.novelAt, [0, 1]);
});

test('alternatives', () => {
  const t = new Trace('7'); const r = new Rng('7', t).fork('a');
  r.choose('p', {}, { p: 0.5 }); r.count('n', {}, 1, 3); r.choose('x', {}, ['u', 'v']); r.order('o', {}, [1, 2, 3]);
  const d = t.decisions;
  assert.deepEqual(d.map(alternatives), [['true', 'false'], ['1', '2', '3'], ['u', 'v'], []]);
  assert.deepEqual(d.map(x => x.kind), ['p', 'count', undefined, 'order']);
});
