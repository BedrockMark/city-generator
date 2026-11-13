import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arterialLanes, paintGround } from './ground';
import { classRaster, crossingsIn } from './cells';
import { blockAt, cellBlocks } from './blocks';
import { cellAt } from './arterials';
import { roundabout, rbSource, RB_CLASS, type Roundabout } from './roundabout';
import { ARTERIAL_LANE, CROSSING_LEN, ROAD_WIDTHS, STREET_WIDTH } from './config';
import { findSegs, slab, ASPHALT, SLAB_BLOCK } from '../gen/layout';
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

test('arterials: double solid centre line and dashed lane lines, each on its own cell, lanes ARTERIAL_LANE wide; streets: one dashed line', () => {
  let arterial = 0, street = 0;
  for (const s of SEEDS) {
    const r: Rect = { x0: -130, y0: -100, x1: 130, y1: 100 };
    const g = paintGround(s, r), cls = classRaster(s, r);
    for (const sg of findSegs(cls, (_a, w) => ROAD_WIDTHS.includes(w))) {
      if (sg.b - sg.a < 20 || sg.a === 0 || sg.b >= (sg.axis === 'h' ? r.x1 - r.x0 : r.y1 - r.y0)) continue;
      const w = sg.band1 - sg.band0, mid = sg.band0 + Math.floor(w / 2);
      // a cell well inside the corridor, away from any zebra: across the band, the marks
      const p = sg.a + Math.floor((sg.b - sg.a) / 2);
      const across = Array.from({ length: w }, (_, k) => (sg.axis === 'h' ? g.mark[sg.band0 + k][p] : g.mark[p][sg.band0 + k]));
      if (across.includes('zebra')) continue;
      const want = Array.from({ length: w }, (_, k) => '');
      if (w === STREET_WIDTH) { want[mid - sg.band0] = 'dash'; street++; }
      else {
        want[mid - sg.band0] = 'centre';
        for (let m = 1; m < arterialLanes(w); m++) {
          want[mid - sg.band0 - m * (ARTERIAL_LANE + 1)] = 'dash'; want[mid - sg.band0 + m * (ARTERIAL_LANE + 1)] = 'dash';
        }
        // every lane (curb to line, line to line) is ARTERIAL_LANE cells
        const lines = across.map((m, k) => (m ? k : -1)).filter(k => k >= 0);
        const gaps = [lines[0], ...lines.slice(1).map((k, i) => k - lines[i] - 1), w - 1 - lines[lines.length - 1]];
        assert.ok(gaps.every(g => g === ARTERIAL_LANE), `${s} lane widths ${gaps} at w=${w}`);
        const [x, y] = sg.axis === 'h' ? [p, mid] : [mid, p];
        assert.equal(g.over[y][x]?.[0], 'city', `${s} centre overlay at ${x + r.x0},${y + r.y0}`);
        arterial++;
      }
      assert.deepEqual(across, want, `${s} ${sg.axis} corridor w=${w} at ${p}`);
    }
  }
  assert.ok(arterial > 5 && street > 20, `arterial ${arterial} street ${street}`);
});

// ---- v0.8.3 roundabouts (spec 2.5) ----

const inR = (r: Rect, x: number, y: number) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;

/** first roundabout of the given arm widths (seeds 1..30, junctions -2..2) */
function findRb(wv: number, wh: number): [string, Roundabout] {
  for (let s = 1; s <= 30; s++) for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
    const rb = roundabout(String(s), i, j);
    if (rb && rb.wv === wv && rb.wh === wh) return [String(s), rb];
  }
  throw new Error(`no ${wv} x ${wh} roundabout`);
}

/** the corner block of the quadrant of R that (x, y) lies in: the block whose footprint (cut or not) holds the
 *  cell diagonally next to the junction on that side */
function cornerPaving(s: string, rb: Roundabout, x: number, y: number): string {
  const cx = x < rb.x0 + rb.wv / 2 ? rb.x0 - 1 : rb.x0 + rb.wv, cy = y < rb.y0 + rb.wh / 2 ? rb.y0 - 1 : rb.y0 + rb.wh;
  const [i, j] = cellAt(s, cx, cy)!;
  return cellBlocks(s, i, j).find(b => b.foot.some(f => inR(f, cx, cy)))!.paving;
}

for (const [wv, wh] of [[11, 11], [17, 11]] as const) {
  test(`ground of an ${wv} x ${wh} roundabout`, () => {
    const [s, rb] = findRb(wv, wh);
    const g = paintGround(s, rb.R), cls = classRaster(s, rb.R);
    let sprites = 0, asphalt = 0;
    for (let y = rb.R.y0; y < rb.R.y1; y++) for (let x = rb.R.x0; x < rb.R.x1; x++) {
      const [col, row] = rbSource(rb, x, y), at = `${s} ${x},${y} (source ${col},${row})`;
      const base = g.base[y - rb.R.y0][x - rb.R.x0], island = inR(rb.island, x, y);
      const box = col >= 19 && col <= 23 && row >= 13 && row <= 17, c = RB_CLASS[row - 9][col - 14];
      if (!island && (box || c === 'A')) {
        assert.ok(ASPHALT.some(([t]) => JSON.stringify(t) === JSON.stringify(base)), `${at}: not asphalt ${base}`);
        asphalt++;
      }
      if (c === 'r' && !box) {
        const [bx, by] = SLAB_BLOCK[cornerPaving(s, rb, x, y)];
        assert.deepEqual(base, ['city', bx + col, by + row], at);
        sprites++;
      }
      const road = cls[y - rb.R.y0][x - rb.R.x0] === 'road';
      assert.equal(g.mark[y - rb.R.y0][x - rb.R.x0] === 'roundabout', road && !island, `${at}: mark`);
    }
    assert.ok(sprites > 50 && asphalt > 20, `sprites ${sprites} asphalt ${asphalt}`);
  });
}

test('roundabout ground is the same in overlapping rects', () => {
  for (const [s, rb] of [findRb(11, 11), findRb(17, 11)]) {
    const A = rb.R, h = Math.floor((A.x1 - A.x0) / 2), v = Math.floor((A.y1 - A.y0) / 2);
    for (const B of [{ ...A, x0: A.x0 + h, x1: A.x1 + h }, { ...A, y0: A.y0 - v, y1: A.y1 - v }]) {
      const ga = paintGround(s, A), gb = paintGround(s, B);
      for (let y = Math.max(A.y0, B.y0); y < Math.min(A.y1, B.y1); y++)
        for (let x = Math.max(A.x0, B.x0); x < Math.min(A.x1, B.x1); x++) for (const k of ['base', 'over', 'mark'] as const)
          assert.deepEqual(ga[k][y - A.y0][x - A.x0], gb[k][y - B.y0][x - B.x0], `${s} ${k} at ${x},${y}`);
    }
  }
});

test('no lane line or zebra inside a roundabout', () => {
  let n = 0;
  for (const s of ['1', '2', '3']) for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
    const rb = roundabout(s, i, j);
    if (!rb) continue;
    n++;
    const g = paintGround(s, rb.R);
    for (let y = 0; y < g.mark.length; y++) for (let x = 0; x < g.mark[y].length; x++) {
      assert.ok(!['dash', 'centre', 'zebra'].includes(g.mark[y][x]), `${s} ${g.mark[y][x]} at ${x + rb.R.x0},${y + rb.R.y0}`);
      assert.equal(g.over[y][x], null, `${s} overlay at ${x + rb.R.x0},${y + rb.R.y0}`);
    }
  }
  assert.ok(n > 5, `only ${n} roundabouts`);
});
