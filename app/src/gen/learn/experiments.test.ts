import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expEvidence } from './expreport';
import type { Comparison } from './prefs';
import type { Scene } from '../types';

const scene = (objs: { exp?: string; x: number; y: number }[], zones: { exp?: string; rect: { x0: number; y0: number; x1: number; y1: number } }[] = []) =>
  ({ objects: objs.map(o => ({ kind: 'rect', key: 'k', cls: 'prop', x: o.x, y: o.y, w: 10, h: 10, exp: o.exp })), zones: zones.map((z, i) => ({ id: `z${i}`, layer: 'yard', kind: 'k', reason: '', ...z })) }) as unknown as Scene;
const R = { x0: 0, y0: 0, x1: 100, y1: 100 };
const lab = (verdict: 'good' | 'bad', s = scene([{ exp: 'exp-x', x: 10, y: 10 }])) => ({ verdict, rect: R, scene: s });
const cmp = (a: string, b: string, answer: 'a' | 'b' | 'same', id = 'exp-x', label = 'exp.fire'): Comparison =>
  ({ label, ctx: {}, a, b, answer, w: 1, batch: 'f', src: { seed: '1', file: 'f' }, stream: `exp/${id}` });

test('good 6 bad 2 -> promote', () => {
  const e = expEvidence('exp-x', [...Array(6)].map(() => lab('good')).concat([...Array(2)].map(() => lab('bad'))), []);
  assert.equal(e.total, 8); assert.equal(e.goodShare, 0.75); assert.equal(e.suggestion, '建议转正');
});
test('good 2 bad 6 -> retire', () => {
  const e = expEvidence('exp-x', [...Array(2)].map(() => lab('good')).concat([...Array(6)].map(() => lab('bad'))), []);
  assert.equal(e.suggestion, '建议废弃');
});
test('good 3 bad 1 -> keep watching', () => {
  const e = expEvidence('exp-x', [lab('good'), lab('good'), lab('good'), lab('bad')], []);
  assert.equal(e.total, 4); assert.equal(e.suggestion, '继续观察');
});
test('outside region / other experiment do not count; zones intersect', () => {
  const out = scene([{ exp: 'exp-x', x: 500, y: 500 }, { exp: 'exp-y', x: 10, y: 10 }]);
  const z = scene([], [{ exp: 'exp-x', rect: { x0: 90, y0: 90, x1: 200, y1: 200 } }]);
  const e = expEvidence('exp-x', [lab('good', out), lab('bad', z)], []);
  assert.equal(e.good, 0); assert.equal(e.bad, 1);
});
test('A/B counts, ties and other streams ignored', () => {
  const e = expEvidence('exp-x', [], [cmp('false', 'true', 'b'), cmp('true', 'false', 'a'), cmp('true', 'false', 'b'), cmp('true', 'false', 'same'),
    cmp('true', 'false', 'a', 'exp-y'), cmp('true', 'false', 'a', 'exp-x', 'other')]);
  assert.equal(e.abWin, 2); assert.equal(e.abLose, 1); assert.equal(e.total, 3);
});
