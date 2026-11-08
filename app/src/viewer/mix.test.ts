import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mixDistrict, DEFAULT_MIX } from './mix';

test('viewer mix: deterministic in the seed, about one seed in five, every kind possible', () => {
  const kinds = new Set<string>();
  let n = 0;
  for (let i = 1; i <= 1000; i++) {
    const k = mixDistrict(String(i));
    assert.equal(mixDistrict(String(i)), k);
    if (k) { n++; kinds.add(k); }
  }
  assert.ok(n >= 160 && n <= 240, `special districts ${n}/1000 (chance ${DEFAULT_MIX.chance})`);
  assert.equal(kinds.size, Object.keys(DEFAULT_MIX.weights).length);
});

test('viewer mix: chance and per-kind weights are the caller\'s', () => {
  for (let i = 1; i <= 200; i++) {
    assert.equal(mixDistrict(String(i), { chance: 0, weights: { school: 1 } }), undefined);
    assert.equal(mixDistrict(String(i), { chance: 1, weights: { gas: 3, school: 0 } }), 'gas');
    assert.equal(mixDistrict(String(i), { chance: 1, weights: {} }), undefined);
  }
});
