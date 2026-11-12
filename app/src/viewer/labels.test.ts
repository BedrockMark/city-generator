import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storeKey } from './labels';
import type { Scene } from '../gen/types';

const single = (seed: string) => ({ seed, params: {} }) as unknown as Scene;
const city = (seed: string, blockId: string) => ({ seed: `${seed}/${blockId}`, params: { world: { seed, blockId } } }) as unknown as Scene;
const SAFE = /^[\w.-]{1,80}$/;

test('storeKey keeps single-block seeds and makes city block keys file-safe and distinct', () => {
  assert.equal(storeKey(single('42')), '42');
  const k = storeKey(city('1', 'b-1,0/RRL'));
  assert.equal(k, 'w1_b-1_0_RRL');
  assert.match(k, SAFE);
  assert.notEqual(storeKey(city('1', 'b0,1/L')), storeKey(city('1', 'b0,1/R')));
  const long = 'x'.repeat(199);
  const a = storeKey(city(long + 'a', 'b0,0/L')), b = storeKey(city(long + 'b', 'b0,0/L'));
  assert.equal(a.length, 80);
  assert.match(a, SAFE);
  assert.match(b, SAFE);
  assert.notEqual(a, b);
});
