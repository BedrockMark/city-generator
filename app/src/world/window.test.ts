import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockLayout, generateBlock, generateInWindow, ownerCell, _clearWindowCache } from './window';
import { blockById, cellBlocks, _clearBlockCache } from './blocks';
import { worldCell, ownerOf, blockRaster } from './cells';
import { WINDOW_MARGIN } from './config';
import { TILE } from '../gen/types';
import type { BlockRec } from './types';

const SEED = 'w1';
const BLOCKS = cellBlocks(SEED, 0, 0);

test('blockLayout: inP is exactly the block lot; cls agrees with worldCell', () => {
  for (const b of BLOCKS.slice(0, 3)) {
    const { layout: L, ox, oy } = blockLayout(SEED, b);
    const x0 = Math.min(...b.foot.map(f => f.x0)), y0 = Math.min(...b.foot.map(f => f.y0));
    assert.equal(ox, x0 - WINDOW_MARGIN);
    assert.equal(oy, y0 - WINDOW_MARGIN);
    let lots = 0;
    for (let y = 0; y < L.rows; y++) for (let x = 0; x < L.cols; x++) {
      const w = worldCell(SEED, ox + x, oy + y);
      const own = w.block === b.id;
      const want = w.cls === 'road' ? 'road' : own ? w.cls : (w.cls === 'lot' ? 'nlot' : 'nwalk');
      assert.equal(L.cls[y][x], want, `${b.id} cls at ${x},${y}`);
      assert.equal(L.inP[y][x], own && w.cls === 'lot', `${b.id} inP at ${x},${y}`);
      if (L.inP[y][x]) {
        lots++;
        assert.ok(x >= L.bx0 && x < L.bx1 && y >= L.by0 && y < L.by1, `${b.id} lot cell inside the bbox`);
        assert.equal(L.region[y][x], -1);
      }
      if (w.cls === 'road') assert.equal(L.region[y][x], -1);
      if (w.cls !== 'road' && !own) assert.equal(L.regionStyle[L.region[y][x]], blockById(SEED, w.block!).paving);
    }
    assert.ok(lots > 0);
    assert.equal(L.mainStyle, b.paving);
    assert.equal(L.sw, b.sw);
    assert.equal(L.shape, b.shape);
    assert.ok(L.topLimit, 'city mode sets topLimit');
  }
});

test('generateBlock keeps only objects on cells the block owns', () => {
  for (const b of BLOCKS) {
    const { scene, ox, oy } = generateBlock(SEED, b.id);
    assert.ok(scene.objects.length > 0, `${b.id} has objects`);
    for (const o of scene.objects) {
      const [cx, cy] = ownerCell(o);
      assert.equal(ownerOf(SEED, ox + cx, oy + cy), b.id, `${b.id}: ${o.id} ${o.key} at ${cx},${cy}`);
    }
    const ids = new Set(scene.objects.map(o => o.id));
    for (const g of scene.groups ?? []) {
      assert.ok(g.members.length > 0, `${b.id}: group ${g.gid} not empty`);
      for (const m of g.members) assert.ok(ids.has(m), `${b.id}: group ${g.gid} member ${m} kept`);
    }
    assert.deepEqual((scene.params as Record<string, unknown>).world, { seed: SEED, blockId: b.id, zone: b.zone, offset: [ox, oy] });
  }
});

test('generateBlock is deterministic and cache-independent', () => {
  const A = BLOCKS[0].id, B = BLOCKS[1].id;
  _clearWindowCache();
  const a1 = JSON.stringify(generateBlock(SEED, A));
  generateBlock(SEED, B);
  const hit = generateBlock(SEED, A);
  const a2 = JSON.stringify(hit);
  // a caller mutating its result must not corrupt the cache
  hit.scene.objects.length = 0;
  hit.ox = 12345;
  const a3 = JSON.stringify(generateBlock(SEED, A));
  _clearWindowCache();
  _clearBlockCache();
  const a4 = JSON.stringify(generateBlock(SEED, A));
  assert.equal(a2, a1);
  assert.equal(a3, a1);
  assert.equal(a4, a1);
});

// Ruling 5: only buildings must be identical across margins. Small props (gardens, curb furniture, cars, walkers, road
// works) may differ: generator streams are keyed by window-relative coordinates and some streams draw in sequence over
// the whole window, so a different margin gives them different draws. The window is a pure function of (seed, blockId),
// so determinism and locality still hold; what must hold at any margin is the ownership filter.
test('buildings do not depend on the window margin; the ownership filter holds at a larger margin', () => {
  for (const b of BLOCKS) {
    const run = (margin: number) => generateInWindow(SEED, b, blockLayout(SEED, b, margin));
    const big = run(WINDOW_MARGIN + 4);
    const blds = (r: ReturnType<typeof run>) =>
      (r.scene.buildings ?? []).map(x => `${x.label}@${x.rect.x0 + r.ox * TILE},${x.rect.y0 + r.oy * TILE}`).sort();
    assert.deepEqual(blds(big), blds(run(WINDOW_MARGIN)), `${b.id} buildings`);
    for (const o of big.scene.objects) {
      const [cx, cy] = ownerCell(o);
      assert.equal(ownerOf(SEED, big.ox + cx, big.oy + cy), b.id, `${b.id} margin+4: ${o.id} ${o.key} at ${cx},${cy}`);
    }
  }
});

test('blockRaster agrees with ownerOf on block cells and is null on road', () => {
  const r = { x0: -30, y0: -20, x1: 50, y1: 40 };
  const ras = blockRaster(SEED, r);
  for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) {
    const id = ras[y - r.y0][x - r.x0], w = worldCell(SEED, x, y);
    if (w.cls === 'road') assert.equal(id, null, `road ${x},${y}`);
    else assert.equal(id, ownerOf(SEED, x, y), `block cell ${x},${y}`);
  }
});

test('every building stays below the north road centre line', () => {
  for (const b of BLOCKS) {
    const { scene, ox, oy } = generateBlock(SEED, b.id);
    for (const bl of scene.buildings ?? []) {
      const top = bl.rect.y0 / TILE;
      for (let px = bl.rect.x0; px < bl.rect.x1; px += TILE) {
        const x = ox + Math.floor(px / TILE);
        // walk north from the building's foot to the road band, then over it
        let y = oy + Math.floor((bl.solid.y1 - 1) / TILE);
        while (worldCell(SEED, x, y).cls !== 'road') y--;
        const r1 = y + 1;
        while (worldCell(SEED, x, y).cls === 'road') y--;
        const r0 = y + 1, mid = r0 + Math.floor((r1 - r0) / 2);
        assert.ok(oy + top >= mid, `${b.id}: ${bl.id} top ${oy + top} above road centre ${mid} at x=${x}`);
      }
    }
  }
});

test('a jog block generates without throwing', () => {
  let jog: BlockRec | undefined;
  for (let i = -3; i <= 3 && !jog; i++) for (let j = -3; j <= 3 && !jog; j++) jog = cellBlocks(SEED, i, j).find(b => b.shape === 'jog');
  assert.ok(jog, 'found a jog block');
  const { scene } = generateBlock(SEED, jog.id);
  assert.equal(scene.params.shape, 'jog');
  assert.ok(scene.objects.length > 0);
});
