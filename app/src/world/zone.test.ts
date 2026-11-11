import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoneValue, zoneAt } from './zone';
import { ZONE_THRESHOLDS } from './config';
import { hash01 } from './hash';

test('zoneValue is continuous: neighbouring cells differ by < 0.02', () => {
  for (let n = 0; n < 2000; n++) {
    const x = Math.floor(hash01('c', n, 0) * 2000) - 1000, y = Math.floor(hash01('c', n, 1) * 2000) - 1000;
    assert.ok(Math.abs(zoneValue('s', x + 1, y) - zoneValue('s', x, y)) < 0.02, `x jump at ${x},${y}`);
    assert.ok(Math.abs(zoneValue('s', x, y + 1) - zoneValue('s', x, y)) < 0.02, `y jump at ${x},${y}`);
  }
});

test('zoneAt follows ZONE_THRESHOLDS', () => {
  for (let n = 0; n < 2000; n++) {
    const x = Math.floor(hash01('t', n, 0) * 2000) - 1000, y = Math.floor(hash01('t', n, 1) * 2000) - 1000;
    const z = zoneValue('s', x, y), k = zoneAt('s', x, y);
    assert.ok(z >= 0 && z <= 1);
    assert.equal(k === 'downtown', z >= ZONE_THRESHOLDS.downtown);
    assert.equal(k === 'residential', z < ZONE_THRESHOLDS.residential);
  }
});

test('all three zones occur in a 1000 x 1000 area for seeds 1..5', () => {
  for (let s = 1; s <= 5; s++) {
    const cnt = { downtown: 0, mixed: 0, residential: 0 };
    let total = 0;
    for (let x = 0; x < 1000; x += 20) for (let y = 0; y < 1000; y += 20) { cnt[zoneAt(String(s), x, y)]++; total++; }
    for (const k of ['downtown', 'mixed', 'residential'] as const) assert.ok(cnt[k] / total >= 0.1, `seed ${s} ${k} ${cnt[k] / total}`);
  }
});

test('zoneValue is local: same value whatever else was computed before', () => {
  const direct = zoneValue('s', 5, -7);
  for (let n = 0; n < 100; n++) zoneValue('s', n * 37 - 900, n * 53 - 1200);
  assert.equal(zoneValue('s', 5, -7), direct);
});
