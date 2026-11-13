import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRoundabout, roundabout, roundaboutsIn, roundaboutAt, rbSource, rbClass, RB_CLASS, type Roundabout } from './roundabout';
import { junctionZone, vJitter, hJitter } from './junction';
import { vLine, hLine, segmentJog, cellAt } from './arterials';
import { blockAt, blockById } from './blocks';
import { worldCell, classRaster, blockRaster } from './cells';
import { ARTERIAL_SPACING, ROUNDABOUT_CHANCE } from './config';
import type { Rect, ZoneKind } from './types';

const R = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => a + k);
const SEEDS = R(1, 30).map(String);
const FEW = ['1', '2', '3', '4', '7'];
const JUNCTIONS = R(-3, 3).flatMap(i => R(-3, 3).map(j => [i, j] as const));
const inRect = (r: Rect, x: number, y: number) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;
const hits = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

function all(seeds: readonly string[]): [string, Roundabout][] {
  const out: [string, Roundabout][] = [];
  for (const s of seeds) for (const [i, j] of JUNCTIONS) {
    const rb = roundabout(s, i, j);
    if (rb) out.push([s, rb]);
  }
  return out;
}

test('RB_CLASS is 13 rows of 15 classes', () => {
  assert.equal(RB_CLASS.length, 13);
  for (const row of RB_CLASS) assert.match(row, /^[wrA]{15}$/);
});

test('isRoundabout is a hash of (seed, i, j) and the zone', () => {
  const n: Record<ZoneKind, number> = { downtown: 0, mixed: 0, residential: 0 };
  const k: Record<ZoneKind, number> = { downtown: 0, mixed: 0, residential: 0 };
  for (const s of SEEDS) for (const [i, j] of JUNCTIONS) {
    const a = isRoundabout(s, i, j);
    assert.equal(isRoundabout(s, i, j), a);
    assert.equal(roundabout(s, i, j) !== null, a);
    const z = junctionZone(s, i, j);
    n[z]++;
    if (a) k[z]++;
  }
  for (const z of Object.keys(n) as ZoneKind[]) {
    assert.ok(n[z] > 50, `${z}: only ${n[z]} junctions`);
    assert.ok(Math.abs(k[z] / n[z] - ROUNDABOUT_CHANCE[z]) < 0.1, `${z}: ${k[z]} / ${n[z]} vs ${ROUNDABOUT_CHANCE[z]}`);
  }
});

test('segments next to a roundabout do not jog', () => {
  const rbs = all(SEEDS);
  assert.ok(rbs.length > 100);
  for (const [s, rb] of rbs) {
    const { i, j } = rb;
    assert.equal(vLine(s, i, j - 1).x0, vLine(s, i, j).x0, `${s} ${i},${j}`);
    assert.equal(hLine(s, j, i - 1).y0, hLine(s, j, i).y0, `${s} ${i},${j}`);
    assert.equal(segmentJog(s, 'v', i, j), 0);
    assert.equal(segmentJog(s, 'v', i, j - 1), 0);
    assert.equal(segmentJog(s, 'h', j, i), 0);
    assert.equal(segmentJog(s, 'h', j, i - 1), 0);
    assert.equal(rb.x0, vLine(s, i, j).x0);
    assert.equal(rb.y0, hLine(s, j, i).y0);
  }
  // the jog is still drawn away from roundabouts
  let jogged = 0;
  for (const s of SEEDS) for (const [i, j] of JUNCTIONS) if (segmentJog(s, 'v', i, j) > 0) jogged++;
  assert.ok(jogged > 200, `${jogged} jogged segments`);
});

test('adjacent roundabouts share an unjogged segment', () => {
  let found: [string, Roundabout, Roundabout] | null = null;
  for (let n = 1; n <= 500 && !found; n++) for (const [i, j] of JUNCTIONS) {
    const s = String(n), a = roundabout(s, i, j), b = roundabout(s, i, j + 1);
    if (a && b) { found = [s, a, b]; break; }
  }
  assert.ok(found, 'no seed with two roundabouts on one segment');
  const [s, a, b] = found;
  assert.ok(!hits(a.R, b.R));
  assert.equal(vLine(s, a.i, a.j).x0, a.i * ARTERIAL_SPACING.x + vJitter(s, a.i));
  assert.equal(a.x0, b.x0);
  assert.equal(segmentJog(s, 'v', a.i, a.j), 0);
  // both whole: the segment between them is arterial road from R to R
  for (let y = a.R.y1; y < b.R.y0; y++) for (let x = a.x0; x < a.x0 + a.wv; x++) assert.equal(cellAt(s, x, y), null);
  assert.equal(roundaboutAt(s, a.x0, a.y0)!.j, a.j);
  assert.equal(roundaboutAt(s, b.x0, b.y0)!.j, b.j);
});

test('stretch maps source columns 20 / 22 onto the arterial edges for Wv 11 and 17', () => {
  const rbs = all(SEEDS);
  for (const wv of [11, 17]) {
    const hit = rbs.find(([, rb]) => rb.wv === wv);
    assert.ok(hit, `no roundabout with wv ${wv}`);
    const rb = hit[1];
    const y = rb.y0, x = rb.x0;
    assert.equal(rbSource(rb, rb.x0, y)[0], 20);
    assert.equal(rbSource(rb, rb.x0 + rb.wv - 1, y)[0], 22);
    assert.equal(rbSource(rb, rb.R.x0, y)[0], 14);
    assert.equal(rbSource(rb, rb.R.x1 - 1, y)[0], 28);
    assert.equal(rbSource(rb, x, rb.y0)[1], 14);
    assert.equal(rbSource(rb, x, rb.y0 + rb.wh - 1)[1], 16);
    assert.equal(rbSource(rb, x, rb.R.y0)[1], 9);
    assert.equal(rbSource(rb, x, rb.R.y1 - 1)[1], 21);
    assert.equal(rb.R.x1 - rb.R.x0, rb.wv + 12);
    assert.equal(rb.R.y1 - rb.R.y0, rb.wh + 10);
    assert.deepEqual(rb.island, { x0: rb.x0 - 1, x1: rb.x0 + rb.wv + 1, y0: rb.y0, y1: rb.y0 + rb.wh });
    // every cell of R maps into the 15 x 13 source, monotonically
    for (let yy = rb.R.y0; yy < rb.R.y1; yy++) for (let xx = rb.R.x0; xx < rb.R.x1; xx++) {
      const [c, r] = rbSource(rb, xx, yy);
      assert.ok(c >= 14 && c <= 28 && r >= 9 && r <= 21);
      if (xx > rb.R.x0) assert.ok(c - rbSource(rb, xx - 1, yy)[0] <= 1 && c >= rbSource(rb, xx - 1, yy)[0]);
    }
  }
});

test('corner road cells are cut out of the corner block', () => {
  let cut = 0, walk = 0;
  for (const [s, rb] of all(FEW)) {
    for (let y = rb.R.y0; y < rb.R.y1; y++) for (let x = rb.R.x0; x < rb.R.x1; x++) {
      if (inRect(rb.island, x, y)) continue;
      const wc = worldCell(s, x, y), k = rbClass(rb, x, y);
      if (k === 'road') {
        assert.equal(wc.cls, 'road', `${s} r${rb.i},${rb.j} (${x},${y}) road`);
        if (cellAt(s, x, y)) cut++;
      } else if (cellAt(s, x, y)) {
        assert.equal(wc.cls, 'walk', `${s} r${rb.i},${rb.j} (${x},${y}) walk`);
        assert.ok(wc.block?.startsWith('b'), `${s} (${x},${y}) block ${wc.block}`);
        const ij = cellAt(s, x, y)!;
        assert.ok(wc.block!.startsWith(`b${ij[0]},${ij[1]}/`));
        assert.ok(blockAt(s, x, y)!.cut?.length, `${wc.block} has no cut`);
        walk++;
      }
    }
  }
  assert.ok(cut > 0 && walk > 0, `${cut} cut, ${walk} walk`);
});

test('no lot of another block inside a roundabout', () => {
  for (const [s, rb] of all(SEEDS)) {
    const cls = classRaster(s, rb.R), blk = blockRaster(s, rb.R);
    for (let y = 0; y < cls.length; y++) for (let x = 0; x < cls[0].length; x++) {
      if (cls[y][x] === 'lot') assert.equal(blk[y][x], `r${rb.i},${rb.j}`, `${s} r${rb.i},${rb.j} lot of ${blk[y][x]} at (${x + rb.R.x0},${y + rb.R.y0})`);
      // the raster agrees with the road class of the asset outside the island
      if (!inRect(rb.island, x + rb.R.x0, y + rb.R.y0) && rbClass(rb, x + rb.R.x0, y + rb.R.y0) === 'road') assert.equal(cls[y][x], 'road');
    }
  }
});

test('island block', () => {
  let n = 0;
  for (const [s, rb] of all(FEW)) {
    const id = `r${rb.i},${rb.j}`;
    const cx = Math.floor((rb.island.x0 + rb.island.x1) / 2), cy = Math.floor((rb.island.y0 + rb.island.y1) / 2);
    const b = blockAt(s, cx, cy)!;
    assert.equal(b.id, id);
    assert.equal(b.shape, 'roundabout');
    assert.equal(b.sw, 2);
    assert.deepEqual(b.cell, [rb.i, rb.j]);
    assert.equal(b.zone, rb.zone);
    assert.deepEqual(b.foot, [rb.island]);
    assert.ok(Object.isFrozen(b));
    assert.equal(blockById(s, id), b);
    assert.equal(worldCell(s, cx, cy).cls, 'lot');
    assert.equal(worldCell(s, rb.island.x0, rb.island.y0).cls, 'walk');
    assert.equal(worldCell(s, rb.island.x0, rb.island.y0).block, id);
    // centred in R
    assert.equal(rb.island.x0 - rb.R.x0, rb.R.x1 - rb.island.x1);
    assert.equal(rb.island.y0 - rb.R.y0, rb.R.y1 - rb.island.y1);
    for (let y = rb.island.y0 - 1; y <= rb.island.y1; y++) for (let x = rb.island.x0 - 1; x <= rb.island.x1; x++) {
      if (inRect(rb.island, x, y) || !inRect(rb.R, x, y)) continue;
      assert.equal(worldCell(s, x, y).cls, 'road', `${s} ${id} ring (${x},${y})`);
    }
    assert.deepEqual(roundaboutAt(s, cx, cy), rb);
    assert.ok(roundaboutsIn(s, rb.R).some(o => o.i === rb.i && o.j === rb.j));
    n++;
  }
  assert.ok(n > 10);
  assert.throws(() => blockById('1', 'r99,99'));
});

test('roundaboutsIn and roundaboutAt agree with roundabout', () => {
  for (const s of FEW) {
    const area: Rect = { x0: -3 * ARTERIAL_SPACING.x, y0: -3 * ARTERIAL_SPACING.y, x1: 3 * ARTERIAL_SPACING.x, y1: 3 * ARTERIAL_SPACING.y };
    const got = roundaboutsIn(s, area).map(rb => `${rb.i},${rb.j}`);
    const want: string[] = [];
    for (const i of R(-4, 4)) for (const j of R(-4, 4)) {
      const rb = roundabout(s, i, j);
      if (rb && hits(rb.R, area)) want.push(`${i},${j}`);
    }
    assert.deepEqual(got, want);
    for (const [i, j] of JUNCTIONS) {
      const x = i * ARTERIAL_SPACING.x + vJitter(s, i), y = j * ARTERIAL_SPACING.y + hJitter(s, j);
      const at = roundaboutAt(s, x, y);
      assert.equal(at ? `${at.i},${at.j}` : null, isRoundabout(s, i, j) ? `${i},${j}` : null);
    }
  }
});
