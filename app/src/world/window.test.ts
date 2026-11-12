import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockLayout, generateBlock, generateInWindow, ownerCell, _clearWindowCache } from './window';
import { blockById, cellBlocks, _clearBlockCache } from './blocks';
import { worldCell, ownerOf, blockRaster } from './cells';
import { SLAB_PERIOD, WINDOW_MARGIN, ZONES } from './config';
import { TILE } from '../gen/types';
import type { BlockRec } from './types';
import { campusFor, DISTRICTS } from '../gen/district';

const SEED = 'w1';
const BLOCKS = cellBlocks(SEED, 0, 0);

test('blockLayout: inP is exactly the block lot; cls agrees with worldCell', () => {
  for (const b of BLOCKS.slice(0, 3)) {
    const { layout: L, ox, oy } = blockLayout(SEED, b);
    const x0 = Math.min(...b.foot.map(f => f.x0)), y0 = Math.min(...b.foot.map(f => f.y0));
    // the margin, moved out to the slab period
    assert.equal(ox, Math.floor((x0 - WINDOW_MARGIN) / SLAB_PERIOD[0]) * SLAB_PERIOD[0]);
    assert.equal(oy, Math.floor((y0 - WINDOW_MARGIN) / SLAB_PERIOD[1]) * SLAB_PERIOD[1]);
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

// v0.8.0-hotfix1 (NOTE D82): a block's content does not depend on the window margin. Stream labels hold world
// coordinates (Layout.org) and the generator's random subsystems only see what the block owns (its curb runs, the
// stretches of road it owns, the crossings it touches). Margins 5 and 9 larger are not multiples of the slab period.
test('a block does not depend on the window margin: buildings, objects and zones; the ownership filter holds', () => {
  for (const b of BLOCKS) {
    const run = (margin: number) => generateInWindow(SEED, b, blockLayout(SEED, b, margin));
    const base = run(WINDOW_MARGIN);
    const blds = (r: ReturnType<typeof run>) =>
      (r.scene.buildings ?? []).map(x => `${x.label}@${x.rect.x0 + r.ox * TILE},${x.rect.y0 + r.oy * TILE}`).sort();
    const objs = (r: ReturnType<typeof run>) => r.scene.objects.map(o => `${o.key}@${o.x + r.ox * TILE},${o.foot + r.oy * TILE}`).sort();
    const zones = (r: ReturnType<typeof run>) => (r.scene.zones ?? []).map(z => `${z.kind}@${z.rect.x0 + r.ox * TILE},${z.rect.y0 + r.oy * TILE},${z.rect.x1 + r.ox * TILE},${z.rect.y1 + r.oy * TILE}`).sort();
    let big = base;
    for (const m of [WINDOW_MARGIN + 5, WINDOW_MARGIN + 9]) {
      big = run(m);
      assert.deepEqual(blds(big), blds(base), `${b.id} margin ${m}: buildings`);
      assert.deepEqual(objs(big), objs(base), `${b.id} margin ${m}: objects`);
      assert.deepEqual(zones(big), zones(base), `${b.id} margin ${m}: zones`);
    }
    for (const o of big.scene.objects) {
      const [cx, cy] = ownerCell(o);
      assert.equal(ownerOf(SEED, big.ox + cx, big.oy + cy), b.id, `${b.id} margin+9: ${o.id} ${o.key} at ${cx},${cy}`);
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

test('a notch island block is a little square: no buildings, its centre piece and paving on the lot (0.8.1-hotfix1)', () => {
  let n = 0;
  for (const s of ['1', '2', '3']) for (let i = -1; i <= 1 && n < 4; i++) for (let j = -1; j <= 1 && n < 4; j++) {
    for (const b of cellBlocks(s, i, j).filter(o => o.shape === 'island')) {
      if (n >= 4) break;
      n++;
      const { scene } = generateBlock(s, b.id);
      assert.equal(scene.buildings?.length ?? 0, 0, `${s} ${b.id} buildings`);
      const g = scene.groups?.find(q => q.type === 'island');
      assert.ok(g, `${s} ${b.id} has no island group`);
      const centre = scene.objects.filter(o => o.gid === g.gid && (o.reason ?? '').includes('中心物'));
      assert.equal(centre.length, 1, `${s} ${b.id} centre pieces: ${centre.length}`);
      assert.ok(scene.zones?.some(z => z.kind === 'island'), `${s} ${b.id} island zone`);
      // the centre piece is not pruned: nothing of the square goes to the repairs' walkway rule
      assert.ok(!scene.audit!.pruned.some(p => p.gid === g.gid && p.c === 'C15'), `${s} ${b.id} square pruned by C15`);
    }
  }
  assert.ok(n >= 2, `only ${n} island blocks found`);
});

test('a district block generates its landmark on a lot of exactly the campus size', () => {
  const picked: [string, BlockRec][] = [];
  for (let s = 1; s <= 20 && picked.length < 2; s++) for (let i = -2; i <= 2 && picked.length < 2; i++) for (let j = -2; j <= 2 && picked.length < 2; j++) {
    for (const b of cellBlocks(String(s), i, j)) {
      if (b.district && picked.length < 2 && !picked.some(([, o]) => o.district === b.district)) picked.push([String(s), b]);
    }
  }
  assert.equal(picked.length, 2, 'two district blocks of different kinds');
  for (const [s, b] of picked) {
    const kind = b.district!, c = campusFor(`${s}/${b.id}`, kind);
    for (const prefs of [true, false]) {
      const { scene } = generateBlock(s, b.id, { prefs });
      assert.equal(scene.params.district, kind, `${s} ${b.id}`);
      assert.deepEqual(scene.params.interior, [c.W, c.H], `${s} ${b.id} prefs ${prefs}`);
      assert.ok(scene.buildings!.some(o => o.front === 'landmark' && o.label === DISTRICTS[kind].name), `${s} ${b.id} landmark`);
    }
  }
});

test('a world block hands its zone parameters to the generator', () => {
  for (const zone of ['residential', 'downtown'] as const) {
    let b: BlockRec | undefined;
    for (let i = -3; i <= 3 && !b; i++) for (let j = -3; j <= 3 && !b; j++) b = cellBlocks('1', i, j).find(q => q.zone === zone && !q.district && q.shape !== 'island');
    assert.ok(b, `a ${zone} block of seed 1`);
    const ds = generateBlock('1', b!.id).scene.trace!.decisions as { label: string; w?: number[]; p?: number }[];
    assert.deepEqual(ds.find(d => d.label === 'block.mix')!.w, [...ZONES[zone].gen.mix]);
    assert.equal(ds.find(d => d.label === 'block.plaza')!.p, ZONES[zone].gen.plaza);
  }
});
