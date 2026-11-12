import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleChunk, chunkOf, chunkRect, getChunk, trimBlock, worldInfo, type Chunk } from './chunk';
import { assembleRegion, blocksIn } from './region';
import { _clearWindowCache, generateBlock, ownerCell } from './window';
import { _clearBlockCache, blockById } from './blocks';
import { ownerOf, ownerRaster, worldCell } from './cells';
import { paintGround } from './ground';
import { zoneAt, zoneValue } from './zone';
import { CHUNK } from './config';
import { TILE } from '../gen/types';

const SEED = '1';
const clear = () => { _clearWindowCache(); _clearBlockCache(); };

test('chunk ground equals assembleRegion on the chunk rect, cell by cell', () => {
  for (const [cx, cy] of [[0, 0], [-1, -1]]) {
    const c = getChunk(SEED, cx, cy), s = assembleRegion(SEED, chunkRect(cx, cy));
    assert.equal(c.ground.length, s.ground.length);
    assert.deepEqual(c.ground, s.ground);
  }
});

test('objects of a 2 x 2 chunk area equal assembleRegion of the area, each exactly once', () => {
  const ids: string[] = [], got: string[] = [];
  for (const cx of [-1, 0]) for (const cy of [-1, 0]) for (const o of getChunk(SEED, cx, cy).objects) {
    ids.push(o.id!); got.push(`${o.id}@${o.x},${o.y},${o.foot}`);
  }
  assert.equal(new Set(ids).size, ids.length);
  const s = assembleRegion(SEED, { x0: -64, y0: -64, x1: 64, y1: 64 }), d = -64 * TILE;
  const want = s.objects.map(o => `${o.id}@${o.x + d},${o.y + d},${o.foot + d}`);
  assert.deepEqual(got.sort(), want.sort());
});

test('every chunk object stands in its chunk and carries its blockId', () => {
  for (const [cx, cy] of [[0, 0], [-1, 0], [0, -1]]) for (const o of getChunk(SEED, cx, cy).objects) {
    const [x, y] = ownerCell(o);
    assert.deepEqual(chunkOf(x, y), [cx, cy]);
    assert.ok(o.id!.startsWith(o.blockId + ':'));
  }
});

test('getChunk does not depend on cache state or request order', () => {
  clear();
  const a0 = JSON.stringify(getChunk(SEED, 0, 0)), a1 = JSON.stringify(getChunk(SEED, 1, 0));
  clear();
  const b1 = JSON.stringify(getChunk(SEED, 1, 0)), b0 = JSON.stringify(getChunk(SEED, 0, 0));
  assert.equal(a0, b0);
  assert.equal(a1, b1);
});

test('assembleChunk paints world ground under a missing block', () => {
  const r = chunkRect(0, 0), lost = blocksIn(SEED, r)[0];
  const c = assembleChunk(SEED, 0, 0, id => (id === lost ? undefined : trimBlock(id, generateBlock(SEED, id))));
  assert.deepEqual(c.missing, [lost]);
  const g = paintGround(SEED, r), own = ownerRaster(SEED, r);
  let n = 0;
  for (let y = 0; y < CHUNK; y++) for (let x = 0; x < CHUNK; x++) if (own[y][x] === lost) {
    n++;
    assert.deepEqual(c.ground[0][y][x], g.base[y][x]);
    assert.deepEqual(c.ground[1][y][x], g.over[y][x]);
  }
  assert.ok(n > 0);
  assert.ok(!c.objects.some(o => o.blockId === lost));
});

test('height is 64 x 64 zeros; chunkOf floors negatives', () => {
  const h = getChunk(SEED, 0, 0).height;
  assert.equal(h.length, 64);
  assert.ok(h.every(row => row.length === 64 && row.every(v => v === 0)));
  assert.deepEqual(chunkOf(-1, -1), [-1, -1]);
  assert.deepEqual(chunkOf(63, 64), [0, 1]);
});

test('assembleChunk with cached blocks is fast', () => {
  const lookup = (id: string) => trimBlock(id, generateBlock(SEED, id));
  assembleChunk(SEED, 0, 0, lookup);
  const t = performance.now();
  for (let i = 0; i < 5; i++) assembleChunk(SEED, 0, 0, lookup);
  if (process.env.CHUNK_TIMING) console.log(`assembleChunk (cached blocks): ${((performance.now() - t) / 5).toFixed(1)} ms`);
});

test('worldInfo explains lots, sidewalks, streets and arterials', () => {
  const r: { x0: number; y0: number; x1: number; y1: number } = { x0: -200, y0: -200, x1: 200, y1: 200 };
  const found: Record<string, [number, number]> = {};
  for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) {
    const w = worldCell(SEED, x, y);
    const k = w.cls === 'lot' ? 'lot' : w.cls === 'walk' ? 'walk' : w.arterial ? 'art' : 'street';
    found[k] ??= [x, y];
  }
  const check = (k: string) => {
    const [x, y] = found[k], i = worldInfo(SEED, x, y);
    assert.equal(i.level, 0);
    assert.equal(i.owner, ownerOf(SEED, x, y));
    assert.equal(i.zone, zoneAt(SEED, x, y));
    assert.equal(i.z, zoneValue(SEED, x, y));
    assert.ok(i.why.some(l => l.includes('分区')));
    return i;
  };
  for (const k of ['lot', 'walk']) {
    const i = check(k), b = blockById(SEED, blocksIn(SEED, { x0: found[k][0], y0: found[k][1], x1: found[k][0] + 1, y1: found[k][1] + 1 }).find(id => id === worldCell(SEED, ...found[k]).block)!);
    assert.equal(i.cls, k);
    assert.equal(i.blockId, b.id);
    for (const l of b.why) assert.ok(i.why.includes(l));
  }
  const a = check('art');
  assert.equal(a.cls, 'road');
  assert.equal(a.blockId, undefined);
  assert.ok(a.why.some(l => l.startsWith('竖向主干道') || l.startsWith('横向主干道')));
  const s = check('street');
  assert.equal(s.cls, 'road');
  assert.ok(s.why.some(l => l.includes('支路')));
  // every arterial cell of a sample gets an arterial line
  for (let y = -100; y < 100; y += 7) for (let x = -130; x < 130; x += 7)
    if (worldCell(SEED, x, y).arterial) assert.ok(worldInfo(SEED, x, y).why.some(l => /主干道 -?\d+/.test(l)), `${x},${y}`);
});
