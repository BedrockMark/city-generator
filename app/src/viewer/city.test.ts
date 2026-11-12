import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCityUrl, wantedChunks } from './city';
import { CITY_ZOOM } from '../world/config';

const parse = (s: string) => parseCityUrl(new URLSearchParams(s), () => 'R');

test('parseCityUrl reads city, seed, x, y, z and falls back on bad values', () => {
  assert.deepEqual(parse('city=1&seed=7&x=-300&y=40&z=2'), { seed: '7', x: -300, y: 40, z: 2 });
  assert.deepEqual(parse('city=1&z=abc&x=foo'), { seed: 'R', x: 0, y: 0, z: CITY_ZOOM.default });
  assert.equal(parse('city=1&seed=7&z=100')!.z, CITY_ZOOM.max);
  assert.equal(parse('city=1&seed=7&z=0.01')!.z, CITY_ZOOM.min);
  assert.equal(parse('city=1&seed=7&z=-1')!.z, CITY_ZOOM.default);
  assert.equal(parse('city=1&seed=')!.seed, 'R');
  assert.equal(parse('seed=7'), null);
  assert.equal(parse('city=0&seed=7'), null);
});

test('wantedChunks covers the view plus the ring, nearest first, negatives included', () => {
  const view = { x0: -10, y0: -10, x1: 10, y1: 10 };
  const k = (c: [number, number][]) => c.map(([x, y]) => `${x},${y}`).sort();
  const r0 = wantedChunks(view, 0);
  assert.deepEqual(k(r0), ['-1,-1', '-1,0', '0,-1', '0,0']);
  const r1 = wantedChunks(view, 1);
  assert.equal(r1.length, 16);
  assert.equal(new Set(k(r1)).size, 16);
  for (const c of k(r0)) assert.ok(k(r1).includes(c));
  assert.ok(k(r1).includes('-2,-2') && k(r1).includes('1,1'));
  assert.ok(k(r0).includes(k([r1[0]])[0]));
  // the four central chunks come before the ring
  assert.deepEqual(k(r1.slice(0, 4)), k(r0));
  // nearest first: the chunk holding an off-centre view comes first
  const off = wantedChunks({ x0: 100, y0: 10, x1: 120, y1: 20 }, 1);
  assert.deepEqual(off[0], [1, 0]);
  assert.equal(off.length, 9);
  // half-open: a view ending exactly on a chunk edge does not touch the next chunk
  assert.deepEqual(wantedChunks({ x0: 0, y0: 0, x1: 64, y1: 64 }, 0), [[0, 0]]);
});
