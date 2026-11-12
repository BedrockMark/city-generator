import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vLine, hLine, cellRect, cellAt, arterialWhy } from './arterials';
import { ARTERIAL_SPACING as SP, ARTERIAL_JITTER, ARTERIAL_JOG, ARTERIAL_WIDTHS } from './config';
import { arterialLanes } from './ground';

const R = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => a + k);
const inRect = (r: { x0: number; y0: number; x1: number; y1: number }, x: number, y: number) =>
  x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;

// Is (x, y) on some arterial band? A vertical segment spans the rows between its two horizontal bands
// (taking the extreme of both neighbouring horizontal segments); horizontal bands are full-width across junctions.
function onArterial(s: string, x: number, y: number): boolean {
  const i0 = Math.floor(x / SP.x), j0 = Math.floor(y / SP.y);
  for (const i of R(i0 - 2, i0 + 2)) for (const j of R(j0 - 2, j0 + 2)) {
    const v = vLine(s, i, j);
    const top = [hLine(s, j, i - 1), hLine(s, j, i)].map(h => h.y0);
    const bot = [hLine(s, j + 1, i - 1), hLine(s, j + 1, i)].map(h => h.y0 + h.h);
    if (x >= v.x0 && x < v.x0 + v.w && y >= Math.min(...top) && y < Math.max(...bot)) return true;
    const h = hLine(s, j, i);
    const lo = [vLine(s, i, j - 1), vLine(s, i, j)].map(a => a.x0);
    const hi = [vLine(s, i + 1, j - 1), vLine(s, i + 1, j)].map(a => a.x0 + a.w);
    if (y >= h.y0 && y < h.y0 + h.h && x >= Math.min(...lo) && x < Math.max(...hi)) return true;
  }
  return false;
}

test('arterial widths come from ARTERIAL_WIDTHS and are constant along a line', () => {
  const okV = ARTERIAL_WIDTHS.v.map(w => w[0]) as number[], okH = ARTERIAL_WIDTHS.h.map(w => w[0]) as number[];
  for (const s of ['1', '2', '3']) for (const i of R(-6, 6)) {
    const w0 = vLine(s, i, -5).w, h0 = hLine(s, i, -5).h;
    assert.ok(okV.includes(w0)); assert.ok(okH.includes(h0));
    for (const j of R(-5, 5)) { assert.equal(vLine(s, i, j).w, w0); assert.equal(hLine(s, i, j).h, h0); }
  }
});

test('jitter and jog stay within bounds', () => {
  const b = ARTERIAL_JITTER + ARTERIAL_JOG;
  for (const s of ['1', '2', '3']) for (const i of R(-6, 6)) for (const j of R(-6, 6)) {
    assert.ok(Math.abs(vLine(s, i, j).x0 - i * SP.x) <= b);
    assert.ok(Math.abs(hLine(s, j, i).y0 - j * SP.y) <= b);
  }
});

test('cellRect tiles the plane with the arterials: cellAt agrees with cellRect', () => {
  for (const s of ['1', '2', '3']) {
    let nulls = 0, cells = 0;
    const step = s === '1' ? 1 : 7;
    for (let x = -300; x < 300; x += step) for (let y = -200; y < 200; y += step) {
      const c = cellAt(s, x, y);
      if (c) { cells++; assert.ok(inRect(cellRect(s, c[0], c[1]), x, y)); }
      else { nulls++; assert.ok(onArterial(s, x, y), `pocket at ${s} ${x},${y}`); }
    }
    assert.ok(cells > 0 && nulls > 0);
  }
});

test('cellRect interiors never overlap (cellAt is unambiguous)', () => {
  for (const s of ['1', '2']) for (const i of R(-4, 4)) for (const j of R(-4, 4)) {
    const a = cellRect(s, i, j), b = cellRect(s, i + 1, j), c = cellRect(s, i, j + 1);
    assert.ok(a.x1 <= b.x0 && a.y1 <= c.y0);
  }
});

test('cell interiors are splittable sizes', () => {
  for (const s of ['1', '2', '3']) for (const i of R(-6, 6)) for (const j of R(-6, 6)) {
    const r = cellRect(s, i, j), w = r.x1 - r.x0, h = r.y1 - r.y0;
    assert.ok(w >= 80 && w <= 145, `w ${w}`);
    assert.ok(h >= 52 && h <= 112, `h ${h}`);
  }
});

test('negative coordinates: cellAt(s, -1, -1) is a cell with i <= -1 or an arterial', () => {
  for (const s of ['1', '2', '3']) {
    const c = cellAt(s, -1, -1);
    if (c) { assert.ok(c[0] <= -1 && c[1] <= -1); assert.ok(inRect(cellRect(s, c[0], c[1]), -1, -1)); }
    else assert.ok(onArterial(s, -1, -1));
  }
});

test('arterialWhy is Chinese and deterministic', () => {
  assert.equal(arterialWhy('1', 'v', 3), arterialWhy('1', 'v', 3));
  assert.match(arterialWhy('1', 'v', 3), /^竖向主干道 3：宽 \d+ 格（散列抽到），位置偏移 [−\d]+ 格$/);
  assert.match(arterialWhy('1', 'h', -2), /^横向主干道 -2/);
});

test('every arterial width fits whole lanes (lines on cells of their own)', () => {
  for (const [w] of [...ARTERIAL_WIDTHS.v, ...ARTERIAL_WIDTHS.h]) assert.ok(arterialLanes(w) >= 2, `width ${w}`);
});
