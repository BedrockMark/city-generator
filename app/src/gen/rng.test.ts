import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng, Trace, alternatives, forceKey, type Adjust } from './rng';

const draw = (r: Rng, n = 5) => Array.from({ length: n }, () => r.next());

test('same sequence without reseed', () => {
  const r = new Rng('7', new Trace('7')).fork('a').fork('b');
  assert.deepEqual(draw(r), draw(new Rng('7/a/b')));
  assert.equal(r.stream, 'a/b');
});

test('reseed salts a stream and its descendants only', () => {
  const plain = new Rng('7', new Trace('7'));
  const salted = new Rng('7', new Trace('7', { 'a/b': 3 }));
  const pa = plain.fork('a'), sa = salted.fork('a');
  assert.deepEqual(draw(sa), draw(pa));
  assert.deepEqual(draw(salted.fork('a').fork('x')), draw(plain.fork('a').fork('x')));
  const sb = salted.fork('a').fork('b'), pb = plain.fork('a').fork('b');
  assert.equal(sb.stream, 'a/b');
  assert.notDeepEqual(draw(sb), draw(pb));
  const sc = salted.fork('a').fork('b').fork('c'), pc = plain.fork('a').fork('b').fork('c');
  assert.equal(sc.stream, 'a/b/c');
  assert.notDeepEqual(draw(sc), draw(pc));
});

test('trace keys use logical paths', () => {
  const t = new Trace('7', { 'a/b': 3 });
  const r = new Rng('7', t).fork('a').fork('b', { k: 1 });
  r.choose('x', {}, [1, 2]);
  assert.deepEqual(Object.keys(t.streams), ['a/b']);
  assert.equal((t.decisions[0] as { s: string }).s, 'a/b');
});

// ---- stage 7: decision identity, forced decisions, adjust hook ----
type D = { s: string; label: string; i: number; pick: string; forced?: true; m?: Record<string, number>; kind?: string };
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

test('forced choice picks the given option and draws once', () => {
  const mk = (force: Record<string, string>) => { const t = new Trace('7', {}, force); return { t, r: new Rng('7', t).fork('a') }; };
  const f = mk({ 'a|x|0': 'c' }), p = mk({});
  assert.equal(f.r.choose('x', {}, ['a', 'b', 'c']), 'c'); p.r.choose('x', {}, ['a', 'b', 'c']);
  assert.equal(decs(f.t)[0].forced, true); assert.equal(decs(p.t)[0].forced, undefined);
  assert.equal(f.r.next(), p.r.next());
  const fp = mk({ 'a|y|0': 'false' }), pp = mk({});
  assert.equal(fp.r.choose('y', {}, { p: 1 }), false); pp.r.choose('y', {}, { p: 1 });
  assert.equal(decs(fp.t)[0].forced, true); assert.equal(fp.r.next(), pp.r.next());
  const fc = mk({ 'a|n|0': '3' }), pc = mk({});
  assert.equal(fc.r.count('n', {}, 1, 4), 3); pc.r.count('n', {}, 1, 4);
  assert.equal(decs(fc.t)[0].forced, true); assert.equal(fc.r.next(), pc.r.next());
  const fw = mk({ 'a|w|0': 'b' });
  assert.equal(fw.r.choose('w', {}, { weights: [['a', 100], ['b', 0.001]] }), 'b');
});

test('force does not touch other streams', () => {
  const tf = new Trace('7', {}, { 'a|x|0': 'b' }), tp = new Trace('7');
  const rf = new Rng('7', tf), rp = new Rng('7', tp);
  rf.fork('a').choose('x', {}, ['a', 'b']); rp.fork('a').choose('x', {}, ['a', 'b']);
  assert.deepEqual(draw(rf.fork('b')), draw(rp.fork('b')));
  const bf = rf.fork('b'), bp = rp.fork('b');
  assert.deepEqual([bf.choose('x', {}, [1, 2, 3]), bf.count('n', {}, 0, 9)], [bp.choose('x', {}, [1, 2, 3]), bp.count('n', {}, 0, 9)]);
});

test('missing forced option is recorded and not applied', () => {
  const tf = new Trace('7', {}, { 'a|x|0': 'z' }), tp = new Trace('7');
  const vf = new Rng('7', tf).fork('a').choose('x', {}, ['a', 'b', 'c']), vp = new Rng('7', tp).fork('a').choose('x', {}, ['a', 'b', 'c']);
  assert.equal(vf, vp); assert.deepEqual(tf.forceMissed, ['a|x|0']); assert.equal(decs(tf)[0].forced, undefined);
  assert.deepEqual((tf.toJSON() as { forceMissed?: string[] }).forceMissed, ['a|x|0']);
  assert.equal('forceMissed' in tp.toJSON(), false);
});

const run = (seed: string, adjust?: Adjust) => {
  const t = new Trace(seed, {}, {}, adjust); const r = new Rng(seed, t).fork('a');
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
    const t = new Trace(String(s), {}, {}, adj); const r = new Rng(String(s), t).fork('a');
    if (r.choose('x', {}, ['a', 'b']) === 'a') na++;
    if (r.choose('p', {}, { p: 0.5 })) nt++;
    if (s === 0) assert.deepEqual(decs(t)[0].m, { a: 4 });
  }
  assert.ok(na / N > 0.75 && na / N < 0.85, `a ${na / N}`);
  assert.ok(nt / N > 0.75 && nt / N < 0.85, `true ${nt / N}`);
  // a forced decision records no multipliers (its pick did not come from the weights), still forced
  const t = new Trace('7', {}, { 'a|x|0': 'b' }, adj);
  new Rng('7', t).fork('a').choose('x', {}, ['a', 'b']);
  assert.equal(decs(t)[0].forced, true); assert.equal(decs(t)[0].m, undefined); assert.equal(decs(t)[0].pick, 'b');
});

test('novel picks are collected only when the novelty changed them', () => {
  // w0 = [1, 1] (no novelty): seeds where the plain draw already gives 'b' are not novel
  let changed = 0, kept = 0;
  for (let s = 0; s < 200; s++) {
    const plain = new Rng(String(s), new Trace(String(s))).fork('a').choose('x', {}, ['a', 'b']);
    const t = new Trace(String(s), {}, {}, () => ({ w: [1, 9], w0: [1, 1], novel: ['b'] }));
    const v = new Rng(String(s), t).fork('a').choose('x', {}, ['a', 'b']);
    if (v === 'b' && plain === 'a') { changed++; assert.deepEqual(t.novel, ['a|b'], `seed ${s}`); }
    else { kept++; assert.deepEqual(t.novel, [], `seed ${s}: novelty did not change the pick`); }
  }
  assert.ok(changed > 50 && kept > 50, `changed ${changed} kept ${kept}`);
  // a forced pick is not the novelty's doing
  const t = new Trace('7', {}, { 'a|x|0': 'b' }, () => ({ w: [1, 9], novel: ['b'] }));
  new Rng('7', t).fork('a').choose('x', {}, ['a', 'b']);
  assert.deepEqual(t.novel, []);
});

test('novel picks of a rejected proposal are dropped', () => {
  const t = new Trace('7', {}, {}, () => ({ w: [0, 1], w0: [1, 0], novel: ['b'] }));
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
  assert.equal(forceKey('a', 'x', 2), 'a|x|2');
});
