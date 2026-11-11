import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paintGround } from './ground';
import { classRaster, crossingsIn } from './cells';
import { blockAt } from './blocks';
import { CROSSING_LEN } from './config';
import { slab } from '../gen/layout';
import type { Rect } from './types';

const SEEDS = ['1', '2', '3'];

test('seams: painting A and B gives identical tiles on A ∩ B', () => {
  const A: Rect = { x0: -40, y0: -30, x1: 60, y1: 50 }, B: Rect = { x0: 20, y0: 10, x1: 140, y1: 90 };
  for (const s of SEEDS) {
    const ga = paintGround(s, A), gb = paintGround(s, B);
    for (const g of [ga, gb]) for (const k of ['base', 'over', 'mark'] as const) {
      const r = g === ga ? A : B;
      assert.equal(g[k].length, r.y1 - r.y0, `${s} ${k} rows`);
      for (const row of g[k]) assert.equal(row.length, r.x1 - r.x0, `${s} ${k} cols`);
    }
    for (let y = Math.max(A.y0, B.y0); y < Math.min(A.y1, B.y1); y++)
      for (let x = Math.max(A.x0, B.x0); x < Math.min(A.x1, B.x1); x++) for (const k of ['base', 'over', 'mark'] as const) {
        assert.deepEqual(ga[k][y - A.y0][x - A.x0], gb[k][y - B.y0][x - B.x0], `${s} ${k} at ${x},${y}`);
      }
  }
});

test('no null tiles in base', () => {
  for (const s of SEEDS) {
    const r: Rect = { x0: -70, y0: -50, x1: 70, y1: 50 };
    const g = paintGround(s, r);
    for (let y = 0; y < g.base.length; y++) for (let x = 0; x < g.base[y].length; x++) {
      assert.ok(g.base[y][x], `${s} null base at ${x + r.x0},${y + r.y0}`);
    }
  }
});

test('dashes only on road, zebras only on road, never on walk / lot', () => {
  let dashes = 0, zebras = 0;
  for (const s of SEEDS) {
    const r: Rect = { x0: -130, y0: -100, x1: 130, y1: 100 };
    const g = paintGround(s, r), cls = classRaster(s, r);
    for (let y = 0; y < g.mark.length; y++) for (let x = 0; x < g.mark[y].length; x++) {
      const m = g.mark[y][x];
      if (m === 'dash') dashes++;
      if (m === 'zebra') zebras++;
      if (m) assert.equal(cls[y][x], 'road', `${s} ${m} on ${cls[y][x]} at ${x + r.x0},${y + r.y0}`);
    }
    // every crossing cell inside r is marked zebra
    for (const c of crossingsIn(s, r)) for (let k = c.band0; k < c.band1; k++) for (let j = 0; j < CROSSING_LEN; j++) {
      const [x, y] = c.axis === 'h' ? [c.at + j, k] : [k, c.at + j];
      if (x < r.x0 || x >= r.x1 || y < r.y0 || y >= r.y1) continue;
      assert.equal(g.mark[y - r.y0][x - r.x0], 'zebra', `${s} crossing cell ${x},${y}`);
    }
  }
  assert.ok(dashes > 100, `only ${dashes} dashes`);
  assert.ok(zebras > 20, `only ${zebras} zebra cells`);
});

test('slab tiling uses non-negative modulo at negative x', () => {
  let n = 0;
  for (const s of SEEDS) {
    const r: Rect = { x0: -6, y0: -200, x1: 2, y1: 200 };
    const g = paintGround(s, r), cls = classRaster(s, { x0: r.x0 - 1, y0: r.y0 - 1, x1: r.x1 + 1, y1: r.y1 + 1 });
    for (let y = r.y0; y < r.y1; y++) for (let x = -4; x <= -1; x++) {
      if (cls[y - r.y0 + 1][x - r.x0 + 1] !== 'lot') continue;
      let open = true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (cls[y + dy - r.y0 + 1][x + dx - r.x0 + 1] === 'road') open = false;
      }
      if (!open) continue;
      n++;
      // x = -4..-1 continue the pattern columns of x = 0..3; y is shifted by an even amount for the same reason
      assert.deepEqual(g.base[y - r.y0][x - r.x0], slab(blockAt(s, x, y)!.paving, x + 4, y + 400), `${s} lot ${x},${y}`);
    }
  }
  assert.ok(n > 20, `only ${n} interior lot cells at x = -4..-1`);
});
