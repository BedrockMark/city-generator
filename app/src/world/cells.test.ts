import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldCell, roadOwner, ownerOf, classRaster, crossingsIn } from './cells';
import { blockById, lotOf } from './blocks';
import { cellAt } from './arterials';
import { ROAD_WIDTHS, CROSSING_MIN_RUN } from './config';
import type { Rect, WCrossing, BlockRec, WorldCell } from './types';

const SEEDS = ['1', '2', '3', '7', 'city'];
const inRect = (r: Rect, x: number, y: number) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;
const inFoot = (b: BlockRec, x: number, y: number) => b.foot.some(r => inRect(r, x, y));
const key = (c: WCrossing) => `${c.axis}:${c.band0}-${c.band1}@${c.at}`;
const crossRect = (c: WCrossing): Rect => c.axis === 'h'
  ? { x0: c.at, x1: c.at + 2, y0: c.band0, y1: c.band1 }
  : { x0: c.band0, x1: c.band1, y0: c.at, y1: c.at + 2 };
const hits = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const within = (seed: string, r: Rect, s: Rect, cs = crossingsIn(seed, r)) => cs.filter(c => hits(crossRect(c), s)).map(key).sort();

// worldCell memoised per seed, so the brute-force checks below stay fast
const memo = new Map<string, WorldCell>();
function wc(s: string, x: number, y: number): WorldCell {
  const k = `${s}|${x},${y}`;
  let c = memo.get(k);
  if (!c) { c = worldCell(s, x, y); memo.set(k, c); }
  return c;
}

test('worldCell: walk ring of width sw around every lot, roads elsewhere', () => {
  const r: Rect = { x0: -70, y0: -50, x1: 70, y1: 50 };
  for (const s of SEEDS.slice(0, 3)) {
    const ras = classRaster(s, r);
    assert.equal(ras.length, r.y1 - r.y0);
    for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) {
      const c = worldCell(s, x, y);
      assert.equal(ras[y - r.y0][x - r.x0], c.cls, `${s} ${x},${y} raster`);
      if (c.cls === 'road') {
        assert.equal(c.block, undefined);
        assert.equal(!!c.arterial, cellAt(s, x, y) === null, `${s} ${x},${y} arterial flag`);
        continue;
      }
      const b = blockById(s, c.block!);
      assert.ok(inFoot(b, x, y));
      // Chebyshev distance to the outside of the footprint: walk iff <= sw
      let d = 1;
      while (d <= b.sw) {
        let out = false;
        for (let dy = -d; dy <= d && !out; dy++) for (let dx = -d; dx <= d; dx++) if (!inFoot(b, x + dx, y + dy)) { out = true; break; }
        if (out) break;
        d++;
      }
      assert.equal(c.cls, d <= b.sw ? 'walk' : 'lot', `${s} ${x},${y} d=${d} sw=${b.sw}`);
      assert.equal(c.cls === 'lot', lotOf(b, x, y));
    }
  }
});

/** Nearest walk distance and the blocks at that distance, by brute force over worldCell. */
function nearestWalk(s: string, x: number, y: number): { d: number; ids: string[] } {
  for (let d = 1; d <= 8; d++) {
    const ids = new Set<string>();
    for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
      const c = wc(s, x + dx, y + dy);
      if (c.cls === 'walk') ids.add(c.block!);
    }
    if (ids.size) return { d, ids: [...ids].sort() };
  }
  return { d: Infinity, ids: [] };
}

test('roadOwner: every road cell has an owner within 6 cells; ties go to the smaller id', () => {
  let ties = 0;
  for (const s of SEEDS.slice(0, 3)) {
    const r: Rect = { x0: -70, y0: -50, x1: 70, y1: 50 };     // contains the arterial junction near the origin
    const ras = classRaster(s, r);
    for (let y = r.y0; y < r.y1; y++) for (let x = r.x0 + (y & 1); x < r.x1; x += 2) {
      if (ras[y - r.y0][x - r.x0] !== 'road') continue;
      const { d, ids } = nearestWalk(s, x, y);
      assert.ok(d <= 6, `${s} ${x},${y}: nearest walk ${d}`);
      assert.equal(roadOwner(s, x, y), ids[0], `${s} ${x},${y}`);
      if (ids.length > 1) ties++;
    }
  }
  assert.ok(ties > 0, 'no ties exercised');
});

test('ownerOf partitions: each cell has exactly one owner, and it is a block touching that road', () => {
  for (const s of SEEDS.slice(0, 3)) {
    const r: Rect = { x0: -40, y0: -30, x1: 40, y1: 30 };
    for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) {
      const o = ownerOf(s, x, y), c = wc(s, x, y);
      const b = blockById(s, o);                          // throws when the owner is not a block
      if (c.cls !== 'road') { assert.equal(o, c.block); continue; }
      // the owner has a sidewalk cell within the nearest-walk distance of this road cell
      const { d, ids } = nearestWalk(s, x, y);
      assert.equal(o, ids[0], `${s} ${x},${y} owner`);
      let touch = false;
      for (let dy = -d; dy <= d && !touch; dy++) for (let dx = -d; dx <= d; dx++) {
        const n = wc(s, x + dx, y + dy);
        if (n.cls === 'walk' && n.block === b.id) { touch = true; break; }
      }
      assert.ok(touch, `${s} ${x},${y} owner ${o} not within ${d}`);
    }
  }
});

test('crossingsIn is local: crossings of rect A ∩ B are the same computed from A or from B', () => {
  const pairs: [Rect, Rect][] = [
    [{ x0: 0, y0: 0, x1: 100, y1: 100 }, { x0: 60, y0: 0, x1: 160, y1: 100 }],
    [{ x0: -150, y0: -120, x1: -50, y1: -20 }, { x0: -90, y0: -120, x1: 10, y1: -20 }],
    [{ x0: -60, y0: -140, x1: 40, y1: -40 }, { x0: -60, y0: -80, x1: 40, y1: 20 }],
  ];
  let n = 0;
  for (const s of SEEDS) for (const [A, B] of pairs) {
    const I: Rect = { x0: Math.max(A.x0, B.x0), y0: Math.max(A.y0, B.y0), x1: Math.min(A.x1, B.x1), y1: Math.min(A.y1, B.y1) };
    const fromA = within(s, A, I), fromB = within(s, B, I);
    assert.deepEqual(fromA, fromB, `${s} ${JSON.stringify(A)} vs ${JSON.stringify(B)}`);
    assert.deepEqual(crossingsIn(s, I).map(key).sort(), fromA, `${s} direct intersection`);
    n += fromA.length;
  }
  assert.ok(n > 0, 'no crossings in any overlap');
  // every small window agrees with one big window, wherever its edge cuts a road
  for (const s of SEEDS.slice(0, 2)) {
    const big: Rect = { x0: -120, y0: -100, x1: 120, y1: 100 }, all = crossingsIn(s, big);
    for (let y0 = -100; y0 < 70; y0 += 13) for (let x0 = -120; x0 < 90; x0 += 17) {
      const w: Rect = { x0, y0, x1: x0 + 30, y1: y0 + 30 };
      assert.deepEqual(crossingsIn(s, w).map(key).sort(), within(s, big, w, all), `${s} window ${x0},${y0}`);
    }
  }
});

test('crossings sit next to junctions and span the full road width', () => {
  let n = 0;
  const kinds = new Set<string>();
  for (const s of SEEDS) {
    const r: Rect = { x0: -150, y0: -120, x1: 150, y1: 120 };
    const cs = crossingsIn(s, r);
    for (const c of cs) {
      n++;
      const w = c.band1 - c.band0;
      assert.ok(ROAD_WIDTHS.includes(w), `${s} ${key(c)} width ${w}`);
      const at = (p: number, k: number) => (c.axis === 'h' ? worldCell(s, p, k) : worldCell(s, k, p));
      // the zebra covers the whole band and the band is bounded by sidewalk on both sides
      for (let p = c.at; p < c.at + 2; p++) {
        for (let k = c.band0; k < c.band1; k++) assert.equal(at(p, k).cls, 'road', `${s} ${key(c)} zebra cell ${p},${k}`);
        assert.notEqual(at(p, c.band0 - 1).cls, 'road', `${s} ${key(c)} not bounded at ${p}`);
        assert.notEqual(at(p, c.band1).cls, 'road', `${s} ${key(c)} not bounded at ${p}`);
      }
      kinds.add(at(c.at, c.band0).arterial ? 'arterial' : 'street');
      // a junction 1 or 2 cells before or after: the whole band is road there and a cross road leaves it,
      // and the corridor runs on for at least CROSSING_MIN_RUN cells on the other side
      const ok = [-1, 1].some(dir => [0, 1].some(g => {
        const j = dir < 0 ? c.at - 1 - g : c.at + 2 + g;
        for (let k = c.band0; k < c.band1; k++) if (at(j, k).cls !== 'road') return false;
        if (at(j, c.band0 - 1).cls !== 'road' && at(j, c.band1).cls !== 'road') return false;
        for (let t = 1; t <= CROSSING_MIN_RUN; t++) {
          const p = j - dir * t;
          if (at(p, c.band0 - 1).cls === 'road' || at(p, c.band1).cls === 'road') return false;
        }
        return true;
      }));
      assert.ok(ok, `${s} ${key(c)}: no junction next to it`);
    }
  }
  assert.ok(n > 20, `only ${n} crossings`);
  assert.deepEqual([...kinds].sort(), ['arterial', 'street']);
});
