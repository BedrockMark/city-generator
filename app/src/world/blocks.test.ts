import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cellBlocks, blockAt, blockById, lotOf, _clearBlockCache, lotRange, widenToFit, feasible, cellLotRange, reserveCorner } from './blocks';
import { campusFor, DISTRICTS } from '../gen/district';
import { cellRect } from './arterials';
import { STREET_WIDTH, JOG_STEP, JOG_GAP, ISLAND_LOT, ISLAND_ARM, LOT_RANGE, P_LO, P_HI, CENTRE_MIN, DISTRICT_WEIGHTS } from './config';
import type { BlockRec, Rect, ZoneKind } from './types';

const R = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => a + k);
const SEEDS = R(1, 30).map(String);
const CELLS = R(-3, 3).flatMap(i => R(-3, 3).map(j => [i, j] as const));
const inRect = (r: Rect, x: number, y: number) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;
const inFoot = (b: BlockRec, x: number, y: number) => b.foot.some(r => inRect(r, x, y));

function bbox(rs: readonly Rect[]): Rect {
  return { x0: Math.min(...rs.map(r => r.x0)), y0: Math.min(...rs.map(r => r.y0)), x1: Math.max(...rs.map(r => r.x1)), y1: Math.max(...rs.map(r => r.y1)) };
}

// Lot bounding box (footprint bbox minus the sidewalk ring) must lie in the cell's prosperity range (lotW x lotH); a notch
// island's lot is ISLAND_LOT. `seed` is needed for the range.
function checkLot(seed: string, b: BlockRec) {
  const bb = bbox(b.foot);
  const w = bb.x1 - bb.x0 - 2 * b.sw, h = bb.y1 - bb.y0 - 2 * b.sw;
  if (b.shape === 'island') {
    assert.ok(w >= ISLAND_LOT.w[0] && w <= ISLAND_LOT.w[1] && h >= ISLAND_LOT.h[0] && h <= ISLAND_LOT.h[1], `${b.id} island lot ${w}x${h}`);
    return;
  }
  if (b.district) return;                                    // campus-sized: the district test
  const { lotW, lotH } = cellLotRange(seed, b.cell[0], b.cell[1]);
  assert.ok(w >= lotW[0] && w <= lotW[1], `${b.id} lot width ${w} not in ${lotW}`);
  assert.ok(h >= lotH[0] && h <= lotH[1], `${b.id} lot height ${h} not in ${lotH}`);
  // lotOf agrees with the bbox for the rect case
  if (b.shape === 'rect') {
    assert.ok(lotOf(b, bb.x0 + b.sw, bb.y0 + b.sw));
    assert.ok(!lotOf(b, bb.x0 + b.sw - 1, bb.y0 + b.sw));
    assert.ok(lotOf(b, bb.x1 - b.sw - 1, bb.y1 - b.sw - 1));
    assert.ok(!lotOf(b, bb.x1 - b.sw, bb.y1 - b.sw - 1));
  }
}

test('every cell splits and every lot is within its cell range', () => {
  for (const s of SEEDS) for (const [i, j] of CELLS) {
    const bs = cellBlocks(s, i, j);
    assert.ok(bs.length >= 2, `${s} ${i},${j}: ${bs.length} blocks`);
    for (const b of bs) checkLot(s, b);
  }
});

// Blocks and streets tile cell (i, j): no overlap, every non-block cell is street.
function checkTiling(s: string, i: number, j: number) {
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

test('blocks and streets tile the cell: no overlap, every non-block cell is street', () => {
  for (const s of R(1, 5).map(String)) for (const [i, j] of CELLS) checkTiling(s, i, j);
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
      assert.match(b.id, new RegExp(`^b${i},${j}/[LR]*[ID]?$`));
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
      if (b.shape === 'island') cuts--;                       // a notch is no cut: the island is one more leaf
      if (b.shape === 'rect' || b.shape === 'island') { assert.equal(b.foot.length, 1); continue; }
      if (b.shape === 'notch') continue;                      // the notch test
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
    for (const b of bs) checkLot(s, b);
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

test('a notch block is an L around its island, STREET_WIDTH away; the arms keep room for buildings', () => {
  let rects = 0, notches = 0;
  for (const s of SEEDS) for (const [i, j] of CELLS) {
    const bs = cellBlocks(s, i, j);
    for (const b of bs) {
      if (b.shape === 'rect') rects++;
      if (b.shape !== 'notch') continue;
      notches++;
      const isl = bs.find(o => o.id === b.id + 'I');
      assert.ok(isl && isl.shape === 'island' && isl.foot.length === 1, `${b.id} has no island`);
      assert.equal(b.foot.length, 2);
      const r = bbox([...b.foot, ...isl.foot]), q = isl.foot[0];
      // the island sits in a corner of the original rect, which is the notch block's bbox
      assert.deepEqual(bbox(b.foot), r, `${b.id} bbox`);
      assert.ok((q.x0 === r.x0 || q.x1 === r.x1) && (q.y0 === r.y0 || q.y1 === r.y1), `${b.id} island not in a corner`);
      // the street around the island's inner sides: STREET_WIDTH cells, then the notch block
      const east = q.x1 === r.x1, south = q.y1 === r.y1;
      const gx = east ? q.x0 - 1 : q.x1, gy = south ? q.y0 - 1 : q.y1;
      for (let k = 0; k < STREET_WIDTH; k++) {
        assert.ok(!inFoot(b, east ? gx - k : gx + k, (q.y0 + q.y1) >> 1), `${b.id} street beside the island`);
        assert.ok(!inFoot(b, (q.x0 + q.x1) >> 1, south ? gy - k : gy + k), `${b.id} street above / below the island`);
      }
      assert.ok(inFoot(b, east ? gx - STREET_WIDTH : gx + STREET_WIDTH, (q.y0 + q.y1) >> 1));
      assert.ok(inFoot(b, (q.x0 + q.x1) >> 1, south ? gy - STREET_WIDTH : gy + STREET_WIDTH));
      // arms: the lot beside the notch, both ways
      const armW = (east ? q.x0 - STREET_WIDTH - r.x0 : r.x1 - q.x1 - STREET_WIDTH) - 2 * b.sw;
      const armH = (south ? q.y0 - STREET_WIDTH - r.y0 : r.y1 - q.y1 - STREET_WIDTH) - 2 * b.sw;
      assert.ok(armW >= ISLAND_ARM.w && armH >= ISLAND_ARM.h, `${b.id} arms ${armW} x ${armH}`);
      assert.ok(isl.why.some(w => w.includes('小岛')) && b.why.some(w => w.includes('缺角')), `${b.id} why`);
    }
  }
  const ratio = notches / (notches + rects);
  assert.ok(ratio >= 0.03 && ratio <= 0.3, `notch ratio ${ratio.toFixed(3)} (${notches} of ${notches + rects} rect blocks)`);
});

test('lotRange is monotonic in p and hits LOT_RANGE at both ends', () => {
  const lo = { w: LOT_RANGE.lo.w, h: LOT_RANGE.lo.h }, hi = { w: LOT_RANGE.hi.w, h: LOT_RANGE.hi.h };
  assert.deepEqual(lotRange(P_LO), lo);
  assert.deepEqual(lotRange(0), lo);
  assert.deepEqual(lotRange(P_HI), hi);
  assert.deepEqual(lotRange(1), hi);
  for (let k = 0; k < 100; k++) {
    const p = k / 100, a = lotRange(p), b = lotRange(p + 0.01);
    for (const key of ['w', 'h'] as const) for (const e of [0, 1]) assert.ok(b[key][e] <= a[key][e], `p ${p} ${key}[${e}]`);
  }
});

test('widenToFit raises the upper bound until the length is feasible', () => {
  assert.deepEqual(widenToFit(48, [24, 44]), [24, 48]);
  assert.deepEqual(widenToFit(60, [24, 44]), [24, 44]);
  for (let len = 30; len <= 200; len++) for (const r of [[24, 44], [32, 60], [18, 28], [22, 36]] as const) {
    if (len < r[0]) { assert.throws(() => widenToFit(len, r)); continue; }   // below the lower bound no widening helps
    const w = widenToFit(len, r);
    assert.ok(feasible(len, w), `${len} ${r}`);
    assert.equal(w[0], r[0]);
  }
});

test('the first why line gives prosperity and the target range', () => {
  for (const s of SEEDS) for (const [i, j] of CELLS) {
    const { widened } = cellLotRange(s, i, j);
    for (const b of cellBlocks(s, i, j)) {
      assert.match(b.why[0], /^繁荣度 \d\.\d\d（(闹市|混合|住宅)），地块目标 \d+–\d+ × \d+–\d+/);
      if (widened) assert.ok(b.why[0].includes('放宽'), `${b.id} why[0] lacks 放宽`);
    }
  }
});

test('big rect blocks are marked centre by zone', () => {
  let marked = 0;
  for (const s of SEEDS) for (const [i, j] of CELLS) for (const b of cellBlocks(s, i, j)) {
    const bb = bbox(b.foot), w = bb.x1 - bb.x0 - 2 * b.sw, h = bb.y1 - bb.y0 - 2 * b.sw;
    const big = b.shape === 'rect' && !b.district && w >= CENTRE_MIN.w && h >= CENTRE_MIN.h;
    assert.equal(b.centre !== undefined, big, `${b.id} centre ${b.centre} lot ${w}x${h}`);
    if (!b.centre) continue;
    marked++;
    assert.equal(b.centre, b.zone === 'residential' ? 'garden' : 'plaza');
    assert.ok(b.why.some(x => x.includes('中心留出')), `${b.id} why lacks 中心留出`);
  }
  assert.ok(marked > 0, 'no block marked');
});

const area = (r: Rect) => (r.x1 - r.x0) * (r.y1 - r.y0);
const disjoint = (a: Rect, b: Rect) => a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0;

test('reserveCorner: the footprint sits in the corner, two 5-cell streets, pieces tile the cell', () => {
  const cell: Rect = { x0: 0, y0: 0, x1: 100, y1: 80 };
  const fw = [24, 44] as const, fh = [18, 32] as const;
  for (let start = 0; start < 8; start++) {
    const res = reserveCorner(cell, fw, fh, () => ({ w: 30, h: 22 }), start);
    assert.ok(res, `start ${start}`);
    const { foot, bandRest, rest } = res;
    assert.equal(foot.x1 - foot.x0, 30);
    assert.equal(foot.y1 - foot.y0, 22);
    assert.ok(foot.x0 === cell.x0 || foot.x1 === cell.x1, `start ${start}: foot not on a side edge`);
    assert.ok(foot.y0 === cell.y0 || foot.y1 === cell.y1, `start ${start}: foot not on a top / bottom edge`);
    assert.equal(foot.x0 === cell.x0, res.corner.endsWith('W'));
    assert.equal(foot.y0 === cell.y0, res.corner.startsWith('N'));
    assert.ok(disjoint(foot, bandRest.r) && disjoint(foot, rest.r) && disjoint(bandRest.r, rest.r), `start ${start}: overlap`);
    const streets = res.axis === 'v' ? STREET_WIDTH * 80 + STREET_WIDTH * 30 : STREET_WIDTH * 100 + STREET_WIDTH * 22;
    assert.equal(area(foot) + area(bandRest.r) + area(rest.r) + streets, area(cell), `start ${start}: areas`);
    for (const r of [bandRest.r, rest.r]) assert.ok(feasible(r.x1 - r.x0, fw) && feasible(r.y1 - r.y0, fh), `start ${start}: rest not feasible`);
    assert.match(res.path, /^[LR]{2}$/);
    assert.match(bandRest.path, /^[LR]{2}$/);
    assert.match(rest.path, /^[LR]$/);
  }
});

test('reserveCorner returns null when nothing fits', () => {
  assert.equal(reserveCorner({ x0: 0, y0: 0, x1: 100, y1: 80 }, [24, 44], [18, 32], () => ({ w: 200, h: 200 }), 0), null);
  assert.equal(reserveCorner({ x0: 0, y0: 0, x1: 110, y1: 70 }, [22, 36], [18, 28], () => ({ w: 48, h: 33 }), 0), null);
});

test('district blocks: footprint = campus + sidewalk ring, id ends in D, no notch, no centre', () => {
  const zones = new Set<ZoneKind>();
  for (const s of R(1, 20).map(String)) for (const [i, j] of CELLS) for (const b of cellBlocks(s, i, j)) {
    if (!b.district) continue;
    zones.add(b.zone);
    assert.match(b.id, /^b-?\d+,-?\d+\/[LR]{2}D$/);
    assert.equal(b.shape, 'rect');
    assert.equal(b.foot.length, 1);
    assert.equal(b.centre, undefined, `${b.id} centre`);
    const c = campusFor(`${s}/${b.id}`, b.district), f = b.foot[0];
    assert.equal(f.x1 - f.x0, c.W + 2 * b.sw, `${s} ${b.id} width`);
    assert.equal(f.y1 - f.y0, c.H + 2 * b.sw, `${s} ${b.id} height`);
    assert.ok(b.why.some(w => w.includes(DISTRICTS[b.district!].name) && w.includes('预留')), `${b.id} why`);
    assert.ok(DISTRICT_WEIGHTS[b.zone][b.district] > 0, `${b.id} ${b.district} in ${b.zone}`);
  }
  for (const z of ['downtown', 'mixed', 'residential'] as const) {
    if (Object.values(DISTRICT_WEIGHTS[z]).some(w => w > 0)) assert.ok(zones.has(z), `no district in ${z}`);
  }
});

test('a cell that draws an unplaceable district still splits, with the reason', () => {
  let found: [string, number, number] | undefined;
  for (const s of R(1, 30).map(String)) for (const [i, j] of CELLS) {
    if (found) break;
    if (cellBlocks(s, i, j).some(b => b.why.slice(0, 3).some(w => w.includes('都切不开')))) found = [s, i, j];
  }
  assert.ok(found, 'no cell with an unplaceable district');
  checkTiling(...found);
  assert.ok(!cellBlocks(...found).some(b => b.district));
});
