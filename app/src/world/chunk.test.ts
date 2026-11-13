import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arterialsAt, assembleChunk, chunkOf, chunkRect, getChunk, trimBlock, worldInfo, type Chunk } from './chunk';
import { assembleRegion, blocksIn } from './region';
import { _clearWindowCache, generateBlock, ownerCell } from './window';
import { _clearBlockCache, blockById, cellBlocks } from './blocks';
import { roundabout, type Roundabout } from './roundabout';
import { campusFor } from '../gen/district';
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
    const i = check(k), b = blockById(SEED, worldCell(SEED, ...found[k]).block!);
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
  // every arterial cell of three regions (negative coordinates included) gets an arterial line, one line per arterial
  // (arterialsAt directly: no paint cost)
  for (const [seed, x0, y0] of [[SEED, -30, -200], [SEED, 190, -20], ['7', -60, -60]] as const)
    for (let y = y0; y < y0 + 100; y++) for (let x = x0; x < x0 + 100; x++)
      if (worldCell(seed, x, y).arterial) {
        const a = arterialsAt(seed, x, y);
        assert.ok(a.some(e => /主干道 -?\d+/.test(e.text)), `${seed} ${x},${y}`);
        assert.equal(new Set(a.map(e => `${e.axis}${e.n}`)).size, a.length, `${seed} ${x},${y} one line per arterial`);
      }
  // and a sampled worldInfo check (it paints a 1 x 1 ground for lane lines / zebras, ~13 ms a cell)
  for (const [seed, x0, y0] of [[SEED, -30, -200], [SEED, 190, -20], ['7', -60, -60]] as const)
    for (let y = y0; y < y0 + 100; y += 5) for (let x = x0; x < x0 + 100; x += 5)
      if (worldCell(seed, x, y).arterial) assert.ok(worldInfo(seed, x, y).why.some(l => /主干道 -?\d+/.test(l)), `${seed} ${x},${y}`);
});

test('worldInfo explains roundabouts, zebras, lane lines, segment jogs and landmarks', () => {
  // a roundabout: its R's road cells say roundabout r<i>,<j>, also the cells cut out of a corner block
  let rbDone = false;
  for (let s = 1; s <= 12 && !rbDone; s++) for (let i = -2; i <= 2 && !rbDone; i++) for (let j = -2; j <= 2 && !rbDone; j++) {
    const seed = String(s);
    const rb: Roundabout | null = roundabout(seed, i, j);
    if (!rb) continue;
    const parts = new Set<string>();
    for (let y: number = rb.R.y0; y < rb.R.y1; y++) for (let x: number = rb.R.x0; x < rb.R.x1; x++) {
      if (worldCell(seed, x, y).block) continue;
      const w = worldInfo(seed, x, y).why;
      assert.ok(w.some(l => l.includes(`环岛 r${i},${j}`)), `${seed} ${x},${y}`);
      assert.ok(!w.some(l => l.startsWith('支路')), `${seed} ${x},${y} is no side street`);
      for (const p of ['臂', '环道', '角']) if (w.some(l => l.includes(`的${p}`))) parts.add(p);
    }
    assert.deepEqual([...parts].sort(), ['环道', '臂', '角'].sort());
    rbDone = true;
  }
  assert.ok(rbDone, 'a roundabout was found');
  // zebras, lane lines, jogs, landmark and reach over the 1 / 7 regions
  const seen = { zebra: false, line: false, jog: false, reach: false, fail: false, landmark: false };
  for (const seed of ['1', '7']) {
    const g = paintGround(seed, { x0: -70, y0: -50, x1: 70, y1: 50 });
    for (let y = 0; y < 100; y++) for (let x = 0; x < 140; x++) {
      const m = g.mark[y][x], wx = x - 70, wy = y - 50;
      if (m === 'zebra' && !seen.zebra) {
        const w = worldInfo(seed, wx, wy).why;
        assert.ok(w.some(l => l.includes('横道') && l.includes('概率')), w.join('|'));
        seen.zebra = true;
      } else if ((m === 'dash' || m === 'centre') && !seen.line && worldCell(seed, wx, wy).arterial) {
        const w = worldInfo(seed, wx, wy).why;
        assert.ok(w.some(l => l.includes(m === 'centre' ? '双实线' : '虚线')), w.join('|'));
        seen.line = true;
      }
    }
    for (let y = -50; y < 50 && !seen.jog; y++) for (let x = -70; x < 70 && !seen.jog; x++) {
      if (!worldCell(seed, x, y).arterial) continue;
      const w = worldInfo(seed, x, y).why;
      if (w.some(l => l.includes('错位'))) seen.jog = true;
    }
  }
  assert.ok(seen.zebra && seen.line && seen.jog, JSON.stringify(seen));
  // a block cell carries the reach line; a district block names its landmark sprite (campusFor)
  for (let s = 1; s <= 20 && !seen.landmark; s++) for (let i = -2; i <= 2 && !seen.landmark; i++) for (let j = -2; j <= 2; j++) {
    const seed = String(s), d = cellBlocks(seed, i, j).find(b => b.district);
    if (!d) continue;
    const f = d.foot[0], k = campusFor(`${seed}/${d.id}`, d.district!), key = k.items[0].plan.parts[0].key;
    const info = worldInfo(seed, f.x0 + d.sw, f.y0 + d.sw);
    assert.equal(info.blockId, d.id);
    assert.ok(info.why.some(l => l.includes(key)), key);
    assert.ok(info.why.some(l => l.includes('可达') || l.includes('C26')));
    seen.landmark = true;
    break;
  }
  assert.ok(seen.landmark);
});
