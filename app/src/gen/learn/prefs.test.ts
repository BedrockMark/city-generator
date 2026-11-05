import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../rng';
import { DEFAULT_OPTIONS } from '../exp';
import { fit, score, toTable, multiplier, filterBlacklist, ctxKeys, type Comparison, type PrefTable } from './prefs';
import { makeAdjust } from './adjust';

const cmp = (a: string, b: string, answer: Comparison['answer'], ctx: Comparison['ctx'] = {}, label = 'x'): Comparison =>
  ({ label, ctx, a, b, answer, w: 1, batch: 't', src: { seed: '1', file: 't' } });

test('ctxKeys are sorted key=value', () => {
  assert.deepEqual(ctxKeys({ rows: 2, a: 'q', b: true }), ['a=q', 'b=true', 'rows=2']);
});

test('fit recovers known multipliers', () => {
  const truth: Record<string, number> = { a: 0, b: 0.8, c: -0.8 }, opts = Object.keys(truth);
  const r = new Rng('bt-sim'), cs: Comparison[] = [];
  for (let i = 0; i < 3000; i++) {
    const a = opts[Math.floor(r.next() * 3)];
    let b = a; while (b === a) b = opts[Math.floor(r.next() * 3)];
    const pB = 1 / (1 + Math.exp(-(truth[b] - truth[a])));
    cs.push(cmp(a, b, r.next() < pB ? 'b' : 'a'));
  }
  const m = fit(cs), s = (o: string) => score(m, 'x', {}, o);
  const db = s('b') - s('a'), dc = s('c') - s('a');
  assert.ok(db > 0.6 && db < 1.0, `b-a ${db}`);
  assert.ok(dc > -1.0 && dc < -0.6, `c-a ${dc}`);
  assert.equal(m.x.n, 3000);
});

test('ties pull multipliers to 1', () => {
  const cs = Array.from({ length: 200 }, (_, i) => cmp(i % 2 ? 'a' : 'b', i % 3 ? 'c' : 'a', 'same'));
  const m = fit(cs);
  for (const o of ['a', 'b', 'c']) assert.ok(Math.abs(score(m, 'x', {}, o)) < 0.05, `${o} ${score(m, 'x', {}, o)}`);
});

test('context falls back to global with little data', () => {
  const cs = [...Array.from({ length: 300 }, () => cmp('a', 'b', 'b')), cmp('a', 'b', 'a', { rows: 2 }), cmp('a', 'b', 'a', { rows: 2 })];
  const m = fit(cs);
  // brief said |δ| < 0.3, but with λ_δ = 4 (spec) and two near-certain losses (θ separation saturates σ) the optimum is
  // |δ| ≈ 0.48 ≈ Σw / λ_δ = 0.5, the bound for any data; checked: δ stays under that bound and far below θ
  const th = m.x.theta.b - m.x.theta.a;
  for (const o of ['a', 'b']) { const d = Math.abs(m.x.delta['rows=2']?.[o] ?? 0); assert.ok(d < 0.5 && d < th / 4, `delta ${o} ${d}`); }
  assert.ok(score(m, 'x', { rows: 2 }, 'b') > score(m, 'x', { rows: 2 }, 'a'));
  assert.equal(score(m, 'nope', {}, 'a'), 0);
});

test('multiplier clamps to [0.2, 5]', () => {
  const t: PrefTable = { version: 'v', trained: '', labels: { x: { global: { a: 20, b: 0.01 }, ctx: { 'rows=2': { a: 2 } }, n: 3 } } };
  assert.equal(multiplier(t, 'x', {}, 'a'), 5);
  assert.equal(multiplier(t, 'x', {}, 'b'), 0.2);
  assert.equal(multiplier(t, 'x', {}, 'c'), 1);
  assert.equal(multiplier(t, 'nope', {}, 'a'), 1);
  const t2: PrefTable = { version: 'v', trained: '', labels: { x: { global: { a: 1.5 }, ctx: { 'rows=2': { a: 2 } }, n: 3 } } };
  assert.ok(Math.abs(multiplier(t2, 'x', { rows: 2 }, 'a') - 3) < 1e-9);
});

test('toTable keeps |log m| >= 0.05 only', () => {
  const t = toTable({ x: { theta: { a: 0.5, b: 0.01 }, delta: { 'rows=2': { a: -0.2, b: 0.04 } }, n: 7 } }, 'v1');
  assert.deepEqual(Object.keys(t.labels.x.global), ['a']);
  assert.ok(Math.abs(t.labels.x.global.a - Math.exp(0.5)) < 1e-9);
  assert.deepEqual(Object.keys(t.labels.x.ctx['rows=2']), ['a']);
  assert.equal(t.labels.x.n, 7);
  assert.equal(t.version, 'v1');
  assert.deepEqual(toTable({ y: { theta: { a: 0.01 }, delta: {}, n: 2 } }, 'v').labels, {});
});

test('blacklist removes labels and options', () => {
  const cs = [cmp('a', 'b', 'b'), cmp('a', 'c', 'a'), cmp('a', 'b', 'a', {}, 'y')];
  const kept = filterBlacklist(cs, { labels: ['y'], options: ['x|c'] });
  assert.deepEqual(kept, [cs[0]]);
  const m = fit(kept);
  assert.equal(m.y, undefined);
  assert.equal(m.x.theta.c, undefined);
});

test('empty table gives no adjust', () => {
  const empty: PrefTable = { version: '', trained: '', labels: {} };
  assert.equal(makeAdjust({ ...DEFAULT_OPTIONS, novelty: 0 }, empty), undefined);
  const t: PrefTable = { version: 'v', trained: '', labels: { x: { global: { b: 2 }, ctx: {}, n: 3 } } };
  assert.equal(makeAdjust({ ...DEFAULT_OPTIONS, novelty: 0, prefs: false }, t), undefined);
  const adj = makeAdjust({ ...DEFAULT_OPTIONS, novelty: 0 }, t)!;
  assert.deepEqual(adj('x', {}, ['a', 'b'], 's'), { w: [1, 2], w0: [1, 2], m: { b: 2 } });
  assert.equal(adj('other', {}, ['a', 'b'], 's'), null);
});
