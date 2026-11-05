import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateBase } from '../generate';
import { withDefaults } from '../exp';
import { signature } from '../signature';
import { forceKey, judgeable, isGeometryOption, type Decision } from '../rng';
import type { Placed, PxRect, Scene } from '../types';
import { diffItems, pad, bbox, gap } from './diff';
import { makeQuestion, verify, statsFrom } from './ab';

const OPTS = { ...withDefaults(), exp: { 'exp-02': false } };
const inside = (r: PxRect, o: PxRect) => r.x0 >= o.x0 && r.y0 >= o.y0 && r.x1 <= o.x1 && r.y1 <= o.y1;
const force = (cs: { stream: string; label: string; k: number; b: string }[]) => Object.fromEntries(cs.map(c => [forceKey(c.stream, c.label, c.k), c.b]));
const A3 = generateBase('3', { ...OPTS, force: {} });

test('diff ignores draw sequence numbers', () => {
  const b: Scene = { ...A3, objects: A3.objects.map(o => ({ ...o, sub: (o.sub ?? 0) + 7 })) };
  assert.deepEqual(diffItems(A3, b), []);
  const extra: Placed = { ...A3.objects[0], x: 3, y: 5 };
  const c: Scene = { ...b, objects: [...b.objects.slice(0, 10), extra, ...b.objects.slice(10)] };
  const d = diffItems(A3, c);
  assert.equal(d.length, 1);
  assert.deepEqual(d[0].rect, { x0: 3, y0: 5, x1: 3 + extra.w, y1: 5 + extra.h });
  // a ground cell
  const g = A3.ground.map(l => l.map(r => [...r]));
  g[0][2][4] = ['city', 0, 0];
  assert.deepEqual(diffItems(A3, { ...A3, ground: g }).map(i => i.id), ['g:0:4:2']);
});

test('rect helpers', () => {
  assert.deepEqual(pad({ x0: 10, y0: 10, x1: 20, y1: 20 }), { x0: 2, y0: 2, x1: 28, y1: 28 });
  assert.deepEqual(bbox([{ x0: 0, y0: 5, x1: 4, y1: 6 }, { x0: 2, y0: 1, x1: 9, y1: 3 }]), { x0: 0, y0: 1, x1: 9, y1: 6 });
  assert.equal(bbox([]), null);
  assert.equal(gap({ x0: 0, y0: 0, x1: 10, y1: 10 }, { x0: 5, y0: 5, x1: 20, y1: 20 }), 0);
  assert.equal(gap({ x0: 0, y0: 0, x1: 10, y1: 10 }, { x0: 26, y0: 0, x1: 30, y1: 10 }), 16);
});

test('statsFrom counts pairs, options and same answers', () => {
  const s = statsFrom([{ label: 'x', ctx: { r: 2 }, a: 'p', b: 'q', answer: 'same' }, { label: 'x', ctx: { r: 2 }, a: 'p', b: 's', answer: 'a' }], ['x']);
  assert.equal(s.pairs['x|r=2'], 2);
  assert.equal(s.optPairs['x|r=2|p'], 2);
  assert.equal(s.optPairs['x|r=2|q'], 1);
  assert.deepEqual(s.same.x, { same: 1, n: 2 });
  assert.deepEqual(s.recent, ['x']);
  // recent = labels of the last 20 questions (several per question): kept whole, not cut to 20 labels
  const many = Array.from({ length: 45 }, (_, j) => `l${j}`);
  assert.deepEqual(statsFrom([], many).recent, many);
});

const EMPTY = statsFrom([], []);
const Q7 = makeQuestion({ seed: '7', options: OPTS, stats: EMPTY, big: false, maxTry: 14 });

test('question changes are isolated', () => {
  const { q, a, b } = Q7;
  assert.ok(q.changes.length >= 2, `only ${q.changes.length} changes`);
  assert.ok(q.tried <= 14);
  assert.deepEqual(signature(a), signature(generateBase('7', { ...q.options, force: {} })));
  for (const c of q.changes) {
    assert.ok(!c.big);
    const d = diffItems(a, generateBase('7', { ...q.options, force: force([c]) }));
    assert.ok(d.length > 0);
    for (const i of d) assert.ok(inside(i.rect, c.rect), `${c.label}: ${i.id} outside`);
  }
  for (let i = 0; i < q.changes.length; i++)
    for (let j = i + 1; j < q.changes.length; j++) assert.ok(gap(q.changes[i].rect, q.changes[j].rect) >= 16);
  for (const i of diffItems(a, b)) assert.ok(q.changes.some(c => inside(i.rect, c.rect)), `${i.id} outside every box`);
});

test('question reproduces', () => {
  const { q, a, b } = Q7;
  assert.equal(q.options.exp['exp-02'], false);
  assert.deepEqual(signature(generateBase('7', { ...q.options, force: force(q.changes) })), signature(b));
  assert.deepEqual(signature(generateBase('7', q.options)), signature(a));
});

test('overlapping changes are dropped', () => {
  // two adjacent decisions of one stream whose effects interact: together they add an object neither adds alone
  const add = (sc: Scene, x: number, y: number): Scene => ({ ...sc, objects: [...sc.objects, { ...sc.objects[0], x, y }] });
  const w = A3.objects[0].w;
  const one = add(A3, 100, 100), two = add(A3, 100 + w + 40, 100), both = add(add(two, 100, 100), 94, 100);
  const k1 = forceKey('yard', 'x', 0), k2 = forceKey('yard', 'x', 1);
  const gen = (f: Record<string, string>) => f[k1] && f[k2] ? both : f[k1] ? one : f[k2] ? two : A3;
  const ch = (key: string, sc: Scene) => { const items = diffItems(A3, sc); return { key, b: 'z', items, rect: pad(bbox(items.map(i => i.rect))!) }; };
  const c1 = ch(k1, one), c2 = ch(k2, two);
  assert.ok(gap(c1.rect, c2.rect) >= 16);
  const v = verify(A3, [c1, c2], gen);
  assert.equal(v.kept.length, 1);
  assert.equal(v.b, v.kept[0] === c1 ? one : two);
  // the first change (manual question) is kept
  const p = verify(A3, [c1, c2], gen, 1);
  assert.deepEqual(p.kept, [c1]);
  assert.equal(p.b, one);
  // additive effects pass unchanged
  const sum = add(two, 100, 100);
  assert.equal(verify(A3, [c1, c2], f => f[k1] && f[k2] ? sum : gen(f)).kept.length, 2);
});

test('manual first change, only', () => {
  const d = (A3.trace!.decisions as { s: string; label: string; i: number; pick: string; opts?: string[]; kind?: string }[])
    .find(d => d.s.startsWith('fronts') && !d.kind && d.opts && d.opts.length >= 2)!;
  const b = d.opts!.find(o => o !== d.pick)!;
  const r = makeQuestion({ seed: '3', options: OPTS, stats: EMPTY, big: false, first: { stream: d.s, label: d.label, k: d.i, b }, only: true });
  assert.equal(r.q.kind, 'manual');
  assert.ok(r.q.tried <= 1);
  assert.ok(r.q.changes.length <= 1);
  if (r.q.changes.length) assert.deepEqual([r.q.changes[0].label, r.q.changes[0].b], [d.label, b]);
  else assert.deepEqual(r.q.noEffect, [d.label]);
});

test('JSON-shown (geometry) options are not judgeable', () => {
  assert.ok(isGeometryOption('[11,40]') && isGeometryOption('{"x":3,"y":4}'));
  assert.ok(!isGeometryOption('garden') && !isGeometryOption('true') && !isGeometryOption('3'));
  const d = (x: Partial<Decision>): Decision => ({ s: 'yard', label: 'x', i: 0, n: 2, pick: 'a', opts: ['a', 'b'], ...x });
  assert.ok(judgeable(d({})));
  assert.ok(judgeable(d({ kind: 'p', pick: 'true', opts: undefined })));
  assert.ok(!judgeable(d({ pick: '[11,40]', opts: ['[11,40]', '[12,40]'] })));
  assert.ok(!judgeable(d({ pick: 'a', opts: ['a', '{"x":1}'] })));
  assert.ok(!judgeable(d({ opts: ['a'], n: 1 })));
  assert.ok(!judgeable(d({ kind: 'order', opts: undefined })));
  // the A/B pool: no question change carries a geometry option
  assert.ok(Q7.q.changes.every(c => !isGeometryOption(c.a) && !isGeometryOption(c.b)));
});
