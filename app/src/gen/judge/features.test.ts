import { test } from 'node:test';
import assert from 'node:assert/strict';
import { windows, FEATURES, activeFeatures, featureMatrix } from './features';
import { alignScene, type JGround, type JObj, type JWorld } from './align';
import { generate } from '../generate';

const mk = (cols: number, rows: number, g: (c: number, r: number) => JGround, objs: JObj[] = []): JWorld =>
  ({ name: 't', src: 'ref', cols, rows, ox: 0, oy: 0, ground: Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => g(c, r))), objs });
const obj = (cls: string, fx: number, fy: number, key = cls): JObj => ({ key, cls, fx, fy, bb: { x0: fx - 4, y0: fy - 12, x1: fx + 4, y1: fy } });
const col = (id: string) => activeFeatures([]).findIndex(f => f.id === id);
const one = (w: JWorld) => { const ws = windows(w); assert.equal(ws.length, 1); return featureMatrix(w, ws, activeFeatures([]))[0]; };

test('windows skip mostly-empty ground', () => {
  const ws = windows(mk(12, 12, c => c < 6 ? 'none' : 'paved'));
  assert.deepEqual(ws.map(w => [w.c0, w.r0]), [[4, 0], [4, 4]]);
  assert.deepEqual(ws[0].rect, { x0: 64, y0: 0, x1: 192, y1: 128 });
});

test('windows skip mostly-road ground', () => {
  assert.equal(windows(mk(8, 8, c => c < 5 ? 'road' : 'paved')).length, 0);
  assert.equal(windows(mk(8, 8, c => c < 4 ? 'road' : 'paved')).length, 1);
});

test('ground fractions sum to 1', () => {
  const x = one(mk(8, 8, (c, r) => (['road', 'paved', 'grass', 'wall', 'other'] as const)[(c + r) % 5]));
  const s = ['g.paved', 'g.grass', 'g.wall'].reduce((a, id) => a + x[col(id)], 0);
  assert.ok(Math.abs(s - 1) < 1e-9, 'paving / lawn / building shares sum to 1 (road and other excluded)');
});

test('features are finite on a window with no placeable ground', () => {
  for (const v of one(mk(8, 8, () => 'wall'))) assert.ok(Number.isFinite(v));
});

test('p.row detects an evenly spaced row', () => {
  const row = (xs: number[]) => one(mk(8, 8, () => 'paved', xs.map(x => obj('tree', x, 60))))[col('p.row')];
  assert.equal(row([10, 42, 74, 108]), 1);
  assert.equal(row([10, 42, 102, 122]), 0);
});

test('r.lift counts table–bench pairs', () => {
  const x = one(mk(8, 8, () => 'paved', [obj('table', 60, 60), obj('bench', 40, 60), obj('bench', 80, 60)]));
  assert.ok(Math.abs(x[col('r.lift')] - 2 / 3) < 1e-9);
});

test('blacklist removes a feature', () => {
  assert.equal(activeFeatures(['g.other']).length, FEATURES.length - 1);
  assert.ok(!activeFeatures(['g.other']).some(f => f.id === 'g.other'));
});

test('feature ids are unique and named', () => {
  assert.equal(new Set(FEATURES.map(f => f.id)).size, FEATURES.length);
  assert.ok(FEATURES.every(f => f.name && f.high));
});

test('featureMatrix on a generated map is fast', () => {
  const w = alignScene(generate('7'));
  const t0 = performance.now(); const X = featureMatrix(w, windows(w)); const ms = performance.now() - t0;
  assert.ok(X.length > 20 && X.every(r => r.every(Number.isFinite)));
  assert.ok(ms < 50, `${ms.toFixed(1)} ms`);
});
