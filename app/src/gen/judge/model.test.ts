import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitL1, auc, scoreMatrix, standardize, type JudgeModel } from './model';
import { Rng } from '../rng';

test('fitL1 separates a separable toy set', () => {
  const r = new Rng('toy'); const X: number[][] = [], y: number[] = [];
  for (let i = 0; i < 400; i++) { const c = i % 2; X.push([c ? 1 + r.next() : -1 - r.next(), r.next() * 2 - 1]); y.push(c); }
  const { mean, std } = standardize(X), Z = X.map(row => row.map((v, j) => (v - mean[j]) / std[j]));
  const sw = y.map(() => 1);
  const loose = fitL1(Z, y, sw, 0.001), tight = fitL1(Z, y, sw, 0.1);
  assert.ok(loose.w[0] > 0);
  assert.ok(tight.w[0] > 0);
  assert.equal(tight.w[1], 0);
});

test('fitL1 with a huge lambda keeps only the intercept', () => {
  const X = [[1], [2], [3], [4]], y = [0, 0, 1, 1];
  const { w } = fitL1(X, y, [1, 1, 1, 1], 100);
  assert.deepEqual(w, [0]);
});

test('auc of perfect / reversed / tied ranking', () => {
  assert.equal(auc([0.1, 0.2, 0.8, 0.9], [0, 0, 1, 1]), 1);
  assert.equal(auc([0.9, 0.8, 0.2, 0.1], [0, 0, 1, 1]), 0);
  assert.equal(auc([0.5, 0.5, 0.5, 0.5], [0, 0, 1, 1]), 0.5);
});

test('contrib equals w times z', () => {
  const m: JudgeModel = { features: ['a', 'b'], mean: [1, 0], std: [2, 1], w: [0.5, -1], b: 0.25, lambda: 0, threshold: 0.5, refMeanP90: 0.5, trained: '', data: {} };
  const { p, contrib } = scoreMatrix(m, [[3, 2]]);
  assert.deepEqual(contrib[0], [0.5, -2]);
  assert.ok(Math.abs(p[0] - 1 / (1 + Math.exp(-(0.5 - 2 + 0.25)))) < 1e-12);
});
