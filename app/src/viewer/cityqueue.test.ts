import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CityQueue, type CityJob } from './cityqueue';
import type { CityBlock } from '../world/chunk';

const TABLE: Record<string, string[]> = { '0,0': ['a', 'b'], '1,0': ['b', 'c'] };
const blocksOf = (cx: number, cy: number) => TABLE[`${cx},${cy}`] ?? [];
const fake = (id: string): CityBlock => ({ id, ox: 0, oy: 0, cols: 1, rows: 1, ground: [], objects: [] });
const mk = (size?: number) => new CityQueue(blocksOf, size);
const desc = (j: CityJob | null) => j && (j.kind === 'block' ? `block ${j.id}` : `chunk ${j.cx},${j.cy}`);

test('blocks of the nearest chunk are dispatched first, each block once', () => {
  const q = mk();
  q.want([[0, 0], [1, 0]]);
  assert.deepEqual([q.next(), q.next(), q.next()].map(desc), ['block a', 'block b', 'block c']);
  assert.equal(q.next(), null);
});

test('a chunk job comes as soon as its blocks are done, before further block jobs', () => {
  const q = mk();
  q.want([[0, 0], [1, 0]]);
  q.next(); q.next(); q.next();
  q.blockDone(q.epoch, 'b', fake('b'));
  q.blockDone(q.epoch, 'a', fake('a'));
  const j = q.next();
  assert.ok(j && j.kind === 'chunk');
  assert.equal(`${j.cx},${j.cy}`, '0,0');
  assert.deepEqual(j.blocks.map(b => b.id), ['a', 'b']);
  assert.deepEqual(j.missing, []);
  assert.equal(q.next(), null);
});

test('a failed block still lets its chunks assemble', () => {
  const q = mk();
  q.want([[0, 0]]);
  q.next(); q.next();
  q.blockDone(q.epoch, 'a', null);
  q.blockDone(q.epoch, 'b', fake('b'));
  const j = q.next();
  assert.ok(j && j.kind === 'chunk');
  assert.deepEqual(j.missing, ['a']);
  assert.deepEqual(j.blocks.map(b => b.id), ['b']);
});

test('want() drops chunks no longer wanted', () => {
  const q = mk();
  q.want([[0, 0], [1, 0]]);
  q.want([[1, 0]]);
  assert.deepEqual([q.next(), q.next(), q.next()].map(desc), ['block b', 'block c', null]);
});

test('chunkDone of an unwanted chunk returns false', () => {
  const q = mk();
  q.want([[0, 0], [1, 0]]);
  q.next(); q.next();
  q.blockDone(q.epoch, 'a', fake('a'));
  q.blockDone(q.epoch, 'b', fake('b'));
  assert.equal(desc(q.next()), 'chunk 0,0');
  q.want([[1, 0]]);
  assert.equal(q.chunkDone(q.epoch, 0, 0), false);
  assert.equal(q.chunkDone(q.epoch, 1, 0), true);
  assert.equal(q.idle, true);
});

test('reset() ignores results of earlier jobs', () => {
  const q = mk();
  q.want([[0, 0]]);
  q.next();
  const old = q.epoch;
  q.reset();
  assert.equal(q.epoch, old + 1);
  q.blockDone(old, 'a', fake('a'));
  assert.equal(q.block('a'), undefined);
  assert.equal(q.chunkDone(old, 0, 0), false);
  assert.equal(q.idle, true);
});

test('the block cache never evicts a block a wanted chunk still needs', () => {
  const q = mk(1);
  q.want([[0, 0]]);
  q.next(); q.next();
  q.blockDone(q.epoch, 'a', fake('a'));
  q.blockDone(q.epoch, 'b', fake('b'));
  assert.ok(q.block('a') && q.block('b'));
  assert.equal(desc(q.next()), 'chunk 0,0');
  assert.equal(q.chunkDone(q.epoch, 0, 0), true);
  q.want([]);
  q.blockDone(q.epoch, 'c', fake('c'));
  assert.deepEqual(['a', 'b', 'c'].filter(id => q.block(id)), ['c']);
});

test('idle once nothing is wanted or running', () => {
  const q = mk();
  assert.equal(q.idle, true);
  q.want([[0, 0]]);
  assert.equal(q.idle, false);
  q.next(); q.next();
  q.want([]);
  assert.equal(q.idle, false);   // blocks still running
  q.blockDone(q.epoch, 'a', fake('a'));
  q.blockDone(q.epoch, 'b', fake('b'));
  assert.equal(q.idle, true);
});
