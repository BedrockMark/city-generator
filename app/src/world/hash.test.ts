import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hash01, hashInt, hashPick } from './hash';

test('hash01 is deterministic, in [0,1), and differs by key and by seed', () => {
  assert.equal(hash01('s', 1, 2), hash01('s', 1, 2));
  for (let k = -5000; k < 5000; k++) {
    const v = hash01('s', k, -k);
    assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
  }
  assert.notEqual(hash01('s', 1, 2), hash01('s', 2, 1));
  assert.notEqual(hash01('s', 1), hash01('t', 1));
});

test('hashInt covers [lo, hi] inclusive, roughly uniform', () => {
  const n: Record<number, number> = { 2: 0, 3: 0, 4: 0 };
  for (let k = 0; k < 10000; k++) n[hashInt('s', 2, 4, k)]++;
  for (const v of [2, 3, 4]) {
    assert.ok(n[v] >= 2500 && n[v] <= 4200, `value ${v} share ${n[v] / 10000}`);
  }
});

test('hashPick follows the weights', () => {
  const w = [['a', 3], ['b', 1]] as const;
  let a = 0;
  for (let k = 0; k < 20000; k++) if (hashPick('s', w, k) === 'a') a++;
  const share = a / 20000;
  assert.ok(share >= 0.72 && share <= 0.78, `share ${share}`);
});
