import { test } from 'node:test';
import assert from 'node:assert/strict';
import tileclass from '../data/tileclass.json';
import semclass from '../data/semclass.json';
import sprites from '../data/sprites.json';
import { SHEET_COLS } from '../types';

const TC = tileclass as unknown as Record<string, [string, number][]>;
const SC = semclass as Record<string, string>;

test('lawn 9-slice centre is opaque grass', () => {
  assert.deepEqual(TC.terr[12 * SHEET_COLS.terr + 1], ['grass', 1]);
});

test('every sheet table is a whole number of tile rows', () => {
  for (const k of ['city', 'auto', 'terr'] as const) assert.equal(TC[k].length % SHEET_COLS[k], 0, k);
});

test('sprite classes follow semantics.py', () => {
  assert.equal(SC['3_City_Props/Street_Lamp_1'], 'street_lamp');
  assert.equal(SC['11_Camping/Benched_Table_1'], 'bench');
});

test('semclass covers exactly the sprite manifest', () => {
  assert.deepEqual(Object.keys(SC).sort(), Object.keys(sprites).sort());
});
