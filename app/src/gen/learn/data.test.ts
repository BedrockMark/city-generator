import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isGeometryOption } from '../rng';
import { attributeLabels, labelComparisons, loadChoiceComparisons, NO_DECISIONS } from './data';

const att = attributeLabels();

test('old labels regenerate with novelty 0', () => {
  const sig = att.skipped.filter(s => s.why.includes('签名不同'));
  assert.ok(sig.length <= 2, `skipped for signature: ${sig.map(s => `${s.file}#${s.id}`).join(', ')}`);
  assert.ok(att.items.length >= 10, `items ${att.items.length}`);
  const none = att.skipped.filter(s => s.file.startsWith('v0.5.1/') && NO_DECISIONS.includes(s.why));
  assert.equal(none.length, 0, `skipped for no decisions: ${none.map(s => `${s.file}#${s.id} ${s.why}`).join('; ')}`);
});

test('bad label makes chosen option lose', () => {
  const bad = att.items.find(it => it.label.verdict === 'bad');
  assert.ok(bad);
  const cs = labelComparisons([bad]);
  assert.ok(cs.length >= 1);
  assert.ok(cs.every(c => c.answer === 'b'));
  assert.ok(Math.abs(cs.reduce((s, c) => s + c.w, 0) - 0.3) < 1e-9);
  assert.ok(cs.every(c => c.batch === `label:${bad.file}#${bad.label.id}`));
  const good = att.items.find(it => it.label.verdict === 'good');
  if (good) assert.ok(labelComparisons([good]).every(c => c.answer === 'a'));
});

test('unknown labels are skipped and counted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'choices-'));
  try {
    mkdirSync(join(dir, 'v0.7.0'));
    const rect = { x0: 0, y0: 0, x1: 16, y1: 16 };
    writeFileSync(join(dir, 'v0.7.0', 'seed1_1.json'), JSON.stringify({ version: '0.7.0', seed: '1', options: {}, novelty: 0, created: '', kind: 'auto',
      changes: [{ stream: 'fronts/b1', label: 'x', k: 0, a: 'p', b: 'q', rect },
        { stream: 'exp/exp-01', label: 'exp.fire', k: 0, ctx: { exp: 'exp-01' }, a: 'true', b: 'false', rect, answer: 'b' },
        { stream: 'block', label: 'pack.run', k: 0, a: '[11,40]', b: '[12,40]', rect, answer: 'a' }] }));
    const r = loadChoiceComparisons(dir);
    assert.equal(r.files, 1);
    assert.equal(r.skipped, 2);   // unanswered + geometry option
    assert.equal(r.cs.length, 1);
    assert.deepEqual({ ...r.cs[0], src: undefined }, { label: 'exp.fire', ctx: { exp: 'exp-01' }, a: 'true', b: 'false', answer: 'b', w: 1,
      batch: 'v0.7.0/seed1_1.json', stream: 'exp/exp-01', src: undefined });
    assert.equal(r.cs[0].src.seed, '1');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('label comparisons never use JSON-shown (geometry) options', () => {
  const cs = labelComparisons(att.items);
  assert.ok(cs.length > 0);
  assert.ok(cs.every(c => !isGeometryOption(c.a) && !isGeometryOption(c.b)), cs.filter(c => isGeometryOption(c.a) || isGeometryOption(c.b)).map(c => c.label).join(', '));
});
