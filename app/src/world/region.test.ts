import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleRegion, blocksIn } from './region';
import { _clearWindowCache } from './window';
import { _clearBlockCache } from './blocks';
import { ownerOf, worldCell } from './cells';
import { TILE, type Scene } from '../gen/types';
import type { Rect } from './types';

const SEED = 'r1';
const R: Rect = { x0: 0, y0: 0, x1: 128, y1: 64 };
const LEFT: Rect = { x0: 0, y0: 0, x1: 64, y1: 64 };
const RIGHT: Rect = { x0: 64, y0: 0, x1: 128, y1: 64 };

/** objects as (key, world px x, world px y), sorted */
const objs = (sc: Scene, r: Rect) => sc.objects.map(o => `${o.key}@${o.x + r.x0 * TILE},${o.y + r.y0 * TILE}`).sort();
/** zones as (id, kind, world px rect), sorted */
const zns = (sc: Scene, r: Rect) => (sc.zones ?? []).map(z =>
  `${z.id} ${z.kind}@${z.rect.x0 + r.x0 * TILE},${z.rect.y0 + r.y0 * TILE},${z.rect.x1 + r.x0 * TILE},${z.rect.y1 + r.y0 * TILE}`).sort();
/** ground tile of world cell (x, y) in every layer */
const tileAt = (sc: Scene, r: Rect, x: number, y: number) => JSON.stringify(sc.ground.map(l => l[y - r.y0][x - r.x0]));

test('blocksIn: sorted, and lists the owner of every cell of the region', () => {
  const r: Rect = { x0: -20, y0: -10, x1: 40, y1: 30 };
  const ids = blocksIn(SEED, r);
  assert.deepEqual(ids, [...ids].sort());
  const set = new Set(ids);
  for (let y = r.y0; y < r.y1; y += 3) for (let x = r.x0; x < r.x1; x += 3) assert.ok(set.has(ownerOf(SEED, x, y)), `owner of ${x},${y}`);
});

let whole: Scene;

test('assembleRegion: object ids are unique, every object inside the region', () => {
  whole = assembleRegion(SEED, R);
  assert.equal(whole.cols, R.x1 - R.x0);
  assert.equal(whole.rows, R.y1 - R.y0);
  assert.ok(whole.objects.length > 0);
  const ids = whole.objects.map(o => o.id);
  assert.equal(new Set(ids).size, ids.length, 'unique ids');
  for (const o of whole.objects) {
    const cx = o.fp ? Math.floor((o.fp.x0 + o.fp.x1) / 2 / TILE) : Math.floor((o.x + o.w / 2) / TILE);
    const cy = o.fp ? Math.floor((o.fp.y0 + o.fp.y1) / 2 / TILE) : Math.floor((o.foot - 1) / TILE);
    assert.ok(cx >= 0 && cy >= 0 && cx < whole.cols && cy < whole.rows, `${o.id} ${o.key} at ${cx},${cy}`);
  }
  for (let y = R.y0; y < R.y1; y++) for (let x = R.x0; x < R.x1; x++) {
    const c = worldCell(SEED, x, y).cls;
    assert.equal(whole.cells[y - R.y0][x - R.x0], c, `cell ${x},${y}`);
  }
  const p = whole.params.world as { seed: string; rect: Rect; blocks: string[] };
  assert.deepEqual(p, { seed: SEED, rect: R, blocks: blocksIn(SEED, R) });
  const kept = new Set(whole.objects.map(o => o.id));
  for (const g of whole.groups ?? []) for (const m of g.members) assert.ok(kept.has(m), `group ${g.gid} member ${m}`);
});

test('every building lies on cells owned by its block and has a kept sprite', () => {
  const gids = new Set(whole.objects.map(o => o.gid));
  assert.ok((whole.buildings ?? []).length > 0);
  for (const b of whole.buildings ?? []) {
    assert.ok(gids.has(b.gid), `${b.gid} has objects`);
    const block = b.gid.slice(0, b.gid.indexOf(':bld:'));
    for (let py = b.solid.y0; py < b.solid.y1; py += TILE) for (let px = b.solid.x0; px < b.solid.x1; px += TILE) {
      const x = R.x0 + Math.floor(px / TILE), y = R.y0 + Math.floor(py / TILE);
      assert.equal(ownerOf(SEED, x, y), block, `${b.gid} solid cell ${x},${y}`);
    }
  }
});

test('zones: centred on a cell of the region owned by their block, gids name kept groups, no road zone duplicated', () => {
  const zones = whole.zones ?? [];
  assert.ok(zones.some(z => z.kind === 'carriageway'), 'has carriageways');
  const gids = new Set((whole.groups ?? []).map(g => g.gid));
  const cover = new Map<string, string>();       // `${kind}@${x},${y}` -> zone id, for road zones
  for (const z of zones) {
    const block = z.id.slice(0, z.id.lastIndexOf(':'));
    const cx = Math.floor((z.rect.x0 + z.rect.x1) / 2 / TILE), cy = Math.floor((z.rect.y0 + z.rect.y1) / 2 / TILE);
    assert.ok(cx >= 0 && cy >= 0 && cx < whole.cols && cy < whole.rows, `${z.id} centre ${cx},${cy} in the region`);
    assert.equal(ownerOf(SEED, R.x0 + cx, R.y0 + cy), block, `${z.id} ${z.kind} centre owned by its block`);
    if (z.gid !== undefined) assert.ok(gids.has(z.gid), `${z.id} gid ${z.gid} is a kept group`);
    if (z.layer !== 'road') continue;
    for (let py = z.rect.y0; py < z.rect.y1; py += TILE) for (let px = z.rect.x0; px < z.rect.x1; px += TILE) {
      const k = `${z.kind}@${Math.floor(px / TILE)},${Math.floor(py / TILE)}`;
      assert.ok(!cover.has(k), `${k} covered by ${cover.get(k)} and ${z.id}`);
      cover.set(k, z.id);
    }
  }
});

let halves: [string, string];

test('assembleRegion is the same for a rect computed whole or as the union of two halves', () => {
  const l = assembleRegion(SEED, LEFT), rt = assembleRegion(SEED, RIGHT);
  for (let y = R.y0; y < R.y1; y++) for (let x = R.x0; x < R.x1; x++) {
    const [h, hr] = x < LEFT.x1 ? [l, LEFT] : [rt, RIGHT];
    assert.equal(tileAt(h, hr, x, y), tileAt(whole, R, x, y), `ground ${x},${y}`);
  }
  assert.deepEqual([...objs(l, LEFT), ...objs(rt, RIGHT)].sort(), objs(whole, R));
  assert.deepEqual([...zns(l, LEFT), ...zns(rt, RIGHT)].sort(), zns(whole, R));
  halves = [JSON.stringify(l), JSON.stringify(rt)];
});

test('order independence: computing the right half first gives the same result', () => {
  // cold caches, so the right half's blocks are generated first this time
  _clearWindowCache();
  _clearBlockCache();
  const rt = JSON.stringify(assembleRegion(SEED, RIGHT)), l = JSON.stringify(assembleRegion(SEED, LEFT));
  assert.equal(l, halves[0]);
  assert.equal(rt, halves[1]);
  assert.equal(JSON.stringify(assembleRegion(SEED, R)), JSON.stringify(whole));
});
