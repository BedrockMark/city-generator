import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cellBlocks, blockAt, blockById, lotOf, _clearBlockCache } from './blocks';
import { cellRect } from './arterials';
import { STREET_WIDTH, JOG_STEP, JOG_GAP } from './config';
import type { BlockRec, Rect } from './types';

const R = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => a + k);
const SEEDS = R(1, 30).map(String);
const CELLS = R(-3, 3).flatMap(i => R(-3, 3).map(j => [i, j] as const));
const inRect = (r: Rect, x: number, y: number) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;
const inFoot = (b: BlockRec, x: number, y: number) => b.foot.some(r => inRect(r, x, y));

function bbox(rs: readonly Rect[]): Rect {
  return { x0: Math.min(...rs.map(r => r.x0)), y0: Math.min(...rs.map(r => r.y0)), x1: Math.max(...rs.map(r => r.x1)), y1: Math.max(...rs.map(r => r.y1)) };
}

// Lot bounding box (footprint bbox minus the sidewalk ring) must fit the generator: 18-40 wide, 13-28 high.
function checkLot(b: BlockRec) {
  const bb = bbox(b.foot);
  const w = bb.x1 - bb.x0 - 2 * b.sw, h = bb.y1 - bb.y0 - 2 * b.sw;
  assert.ok(w >= 18 && w <= 40, `${b.id} lot width ${w}`);
  assert.ok(h >= 13 && h <= 28, `${b.id} lot height ${h}`);
  // lotOf agrees with the bbox for the rect case
  if (b.shape === 'rect') {
    assert.ok(lotOf(b, bb.x0 + b.sw, bb.y0 + b.sw));
    assert.ok(!lotOf(b, bb.x0 + b.sw - 1, bb.y0 + b.sw));
    assert.ok(lotOf(b, bb.x1 - b.sw - 1, bb.y1 - b.sw - 1));
    assert.ok(!lotOf(b, bb.x1 - b.sw, bb.y1 - b.sw - 1));
  }
}

test('every block lot is within the generator range 18-40 x 13-28', () => {
  for (const s of SEEDS) for (const [i, j] of CELLS) {
    const bs = cellBlocks(s, i, j);
    assert.ok(bs.length >= 2, `${s} ${i},${j}: ${bs.length} blocks`);
    for (const b of bs) checkLot(b);
  }
});

test('blocks and streets tile the cell: no overlap, every non-block cell is street', () => {
  for (const s of R(1, 5).map(String)) for (const [i, j] of CELLS) {
    const c = cellRect(s, i, j), bs = cellBlocks(s, i, j);
    for (const b of bs) for (const r of b.foot) {
      assert.ok(r.x0 >= c.x0 && r.y0 >= c.y0 && r.x1 <= c.x1 && r.y1 <= c.y1, `${b.id} outside the cell`);
    }
    const W = c.x1 - c.x0, H = c.y1 - c.y0;
    const own = new Int32Array(W * H).fill(-1);
    bs.forEach((b, k) => {
      for (const r of b.foot) for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) {
        const n = (y - c.y0) * W + (x - c.x0);
        assert.equal(own[n], -1, `${s} ${x},${y} in two blocks`);
        own[n] = k;
      }
    });
    // Integral image of block cells: blocks(x0, y0, x1, y1) counts block cells in the clipped half-open window.
    const sum = new Int32Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      sum[(y + 1) * (W + 1) + x + 1] = (own[y * W + x] >= 0 ? 1 : 0) + sum[y * (W + 1) + x + 1] + sum[(y + 1) * (W + 1) + x] - sum[y * (W + 1) + x];
    }
    const blocks = (x0: number, y0: number, x1: number, y1: number) => {
      x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(W, x1); y1 = Math.min(H, y1);
      return x1 <= x0 || y1 <= y0 ? 0 : sum[y1 * (W + 1) + x1] - sum[y0 * (W + 1) + x1] - sum[y1 * (W + 1) + x0] + sum[y0 * (W + 1) + x0];
    };
    // A street cell lies in a STREET_WIDTH band, so a block is within STREET_WIDTH cells (Chebyshev: at a crossing the
    // nearest block is diagonal), and no (STREET_WIDTH + 1)^2 square is free of blocks (no leftover land).
    const S = STREET_WIDTH;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (own[y * W + x] >= 0) continue;
      if (!blocks(x - S, y - S, x + S + 1, y + S + 1)) assert.fail(`${s} cell ${i},${j}: ${x + c.x0},${y + c.y0} is neither block nor street`);
      if (x + S < W && y + S < H && !blocks(x, y, x + S + 1, y + S + 1)) assert.fail(`${s} cell ${i},${j}: block-free square at ${x + c.x0},${y + c.y0}`);
    }
  }
});

test('every block touches a road on at least one side', () => {
  for (const s of R(1, 5).map(String)) for (const [i, j] of CELLS) {
    const bs = cellBlocks(s, i, j);
    for (const b of bs) {
      const others = bs.filter(o => o !== b);
      let touches = false;
      for (const r of b.foot) {
        for (let x = r.x0; x < r.x1 && !touches; x++) for (const y of [r.y0 - 1, r.y1]) {
          if (!inFoot(b, x, y) && !others.some(o => inFoot(o, x, y))) touches = true;
        }
        for (let y = r.y0; y < r.y1 && !touches; y++) for (const x of [r.x0 - 1, r.x1]) {
          if (!inFoot(b, x, y) && !others.some(o => inFoot(o, x, y))) touches = true;
        }
      }
      assert.ok(touches, `${b.id} touches no road`);
    }
  }
});

test('ids are stable and blockById / blockAt agree', () => {
  for (const s of R(1, 5).map(String)) for (const [i, j] of CELLS) {
    for (const b of cellBlocks(s, i, j)) {
      assert.match(b.id, new RegExp(`^b${i},${j}/[LR]*$`));
      assert.deepEqual(b.cell, [i, j]);
      assert.deepEqual(blockById(s, b.id), b);
      for (const r of b.foot) for (const [x, y] of [[r.x0, r.y0], [r.x1 - 1, r.y1 - 1], [(r.x0 + r.x1) >> 1, (r.y0 + r.y1) >> 1]]) {
        assert.equal(blockAt(s, x, y)?.id, b.id);
      }
    }
  }
  const c = cellRect('1', 0, 0);
  assert.equal(blockAt('1', c.x0 - 1, c.y0), null);           // on the arterial
  assert.throws(() => blockById('1', 'b0,0/LLLLLLLLLLLL'));
  assert.throws(() => blockById('1', 'nonsense'));
});

test('a jog block has two rects sharing an edge, and about JOG_CHANCE of cuts jog', () => {
  let cuts = 0, jogLeaves = 0;
  for (const s of SEEDS) for (const [i, j] of CELLS) {
    const bs = cellBlocks(s, i, j);
    cuts += bs.length - 1;                                   // binary cut tree: leaves - 1 cuts
    for (const b of bs) {
      if (b.shape === 'rect') { assert.equal(b.foot.length, 1); continue; }
      jogLeaves++;
      assert.equal(b.foot.length, 2);
      const [p, q] = b.foot;
      const shareH = (p.y1 === q.y0 || q.y1 === p.y0) && Math.min(p.x1, q.x1) > Math.max(p.x0, q.x0);
      const shareV = (p.x1 === q.x0 || q.x1 === p.x0) && Math.min(p.y1, q.y1) > Math.max(p.y0, q.y0);
      assert.ok(shareH || shareV, `${b.id} rects do not share an edge`);
      // one edge straight, the other offset by a JOG_STEP amount
      const [a0, a1, b0, b1] = shareH ? [p.x0, p.x1, q.x0, q.x1] : [p.y0, p.y1, q.y0, q.y1];
      const off = a0 === b0 ? Math.abs(a1 - b1) : a1 === b1 ? Math.abs(a0 - b0) : -1;
      assert.ok(off >= JOG_STEP[0] && off <= JOG_STEP[1], `${b.id} jog offset ${off}`);
      // lotOf on the union: the straight-side corner cell is sidewalk and the cell sw in from it is lot
      const bb = bbox(b.foot), sx = shareH ? (a0 === b0 ? bb.x0 : bb.x1 - 1) : bb.x0, sy = shareH ? bb.y0 : (a0 === b0 ? bb.y0 : bb.y1 - 1);
      const ix = sx === bb.x0 ? sx + b.sw : sx - b.sw, iy = sy === bb.y0 ? sy + b.sw : sy - b.sw;
      assert.ok(!lotOf(b, sx, sy) && lotOf(b, ix, iy), `${b.id} lotOf at the straight corner`);
      assert.ok(b.why.some(w => w.includes('错开')), `${b.id} why lacks the jog`);
    }
  }
  assert.equal(jogLeaves % 2, 0);
  const ratio = jogLeaves / 2 / cuts;
  assert.ok(ratio >= 0.1 && ratio <= 0.4, `jog ratio ${ratio.toFixed(3)} (${jogLeaves / 2} / ${cuts})`);
});

test('negative cells split like positive ones', () => {
  for (const s of SEEDS) {
    const bs = cellBlocks(s, -2, -3);
    assert.ok(bs.length > 0);
    for (const b of bs) checkLot(b);
    for (const b of bs) assert.equal(blockAt(s, b.foot[0].x0, b.foot[0].y0)?.id, b.id);
  }
});

test('cellBlocks is deterministic across calls and cache states', () => {
  for (const s of ['1', '7']) for (const [i, j] of CELLS) {
    const a = cellBlocks(s, i, j);
    assert.ok(Object.isFrozen(a) && Object.isFrozen(a[0]) && Object.isFrozen(a[0].foot[0]));
    _clearBlockCache();
    const b = cellBlocks(s, i, j);
    assert.notEqual(a, b);
    assert.deepEqual(b, a);
    assert.equal(cellBlocks(s, i, j), b);                     // cache hit returns the same object
  }
});

test('a jogged street widens for JOG_GAP cells at the jog and never narrows below STREET_WIDTH', () => {
  for (const s of SEEDS.slice(0, 10)) for (const [i, j] of CELLS) for (const b of cellBlocks(s, i, j)) {
    if (b.shape !== 'jog') continue;
    const [p, q] = b.foot;
    const shareH = p.y1 === q.y0 || q.y1 === p.y0;           // rects stacked: the jogged street is vertical
    // across = coordinate across the street, along = along it; the jogged edge is where the rects differ
    const [pa0, pa1, qa0, qa1] = shareH ? [p.x0, p.x1, q.x0, q.x1] : [p.y0, p.y1, q.y0, q.y1];
    const hi = pa0 === qa0;                                   // the jogged edge is on the high side of the block
    const off = hi ? Math.abs(pa1 - qa1) : Math.abs(pa0 - qa0);
    const bb = bbox(b.foot);
    const [l0, l1] = shareH ? [bb.y0, bb.y1] : [bb.x0, bb.x1];
    const road = (u: number, v: number) => blockAt(s, ...(shareH ? [u, v] : [v, u]) as [number, number]) === null;
    let wide = 0;
    for (let v = l0; v < l1; v++) {
      // the block's own edge at this row, then the road run outwards from it
      let u = hi ? Math.max(...b.foot.filter(r => (shareH ? r.y0 <= v && v < r.y1 : r.x0 <= v && v < r.x1)).map(r => (shareH ? r.x1 : r.y1)))
        : Math.min(...b.foot.filter(r => (shareH ? r.y0 <= v && v < r.y1 : r.x0 <= v && v < r.x1)).map(r => (shareH ? r.x0 : r.y0))) - 1;
      let n = 0;
      while (road(u, v) && n < 40) { n++; u += hi ? 1 : -1; }
      if (n >= 40) continue;                                  // the street ran into an arterial / cross street here
      assert.ok(n >= STREET_WIDTH, `${s} ${b.id} street only ${n} wide at ${v}`);
      if (n === STREET_WIDTH + off) wide++;
    }
    assert.equal(wide, JOG_GAP, `${s} ${b.id} widened rows`);
  }
});
