import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLabelRegions, coveredWindows } from './labelset';
import { windows } from './features';
import { alignScene } from './align';

const regs = loadLabelRegions();
const find = (seed: string, id: string) => regs.find(r => r.seed === seed && r.id === id)!;
const size = (r: { x0: number; y0: number; x1: number; y1: number }) => [r.x1 - r.x0, r.y1 - r.y0];

test('loads only v0.5.1 labels', () => {
  assert.equal(regs.length, 16);
  assert.equal(regs.filter(r => r.verdict === 'good').length, 4);
  assert.equal(regs.filter(r => r.verdict === 'bad').length, 12);
});

test('click label resolves to its zone', () => {
  assert.deepEqual(size(find('87709', 'L1').rect), [512, 48]);
  assert.deepEqual(size(find('225713', 'L1').rect), [16, 176]);
});

test('box label keeps its rect', () => {
  assert.deepEqual(size(find('791885', 'L5').rect), [192, 240]);
});

test('big region maps to several windows', () => {
  const r = find('87709', 'L1');
  assert.ok(coveredWindows(r.rect, windows(alignScene(r.scene))).length >= 2);
});
