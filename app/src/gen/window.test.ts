import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateBase, type BlockWindow } from './generate';
import { withDefaults } from './exp';
import { chebDist, findSegs, paintWalkCell, type Layout } from './layout';
import type { CellClass } from './types';

// Hand-built window: 40 x 30 cells, a 24 x 16 lot in the middle, a 2-cell sidewalk ring, a 5-cell road ring, and the
// leftover border cells (columns 0 and 39) as neighbouring blocks' sidewalk.
const COLS = 40, ROWS = 30, ROAD = 5, SW = 2;
const LX0 = 1 + ROAD + SW, LY0 = ROAD + SW, LW = 24, LH = 16;
/** north road: rows 0..ROAD-1; its centre line */
const NORTH_MID = Math.floor(ROAD / 2);

/** `top`: the layout's topLimit row (every column) */
function testWindow(seed: string, top = NORTH_MID): BlockWindow {
  const grid = <T>(v: T): T[][] => Array.from({ length: ROWS }, () => Array<T>(COLS).fill(v));
  const cls = grid<CellClass>('nwalk');
  const inP = grid(false);
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const d = Math.max(LX0 - x, x - (LX0 + LW - 1), LY0 - y, y - (LY0 + LH - 1), 0);   // Chebyshev distance to the lot
    if (d === 0) { cls[y][x] = 'lot'; inP[y][x] = true; }
    else if (d <= SW) cls[y][x] = 'walk';
    else if (d <= SW + ROAD) cls[y][x] = 'road';
  }
  // the two border columns are two neighbour regions
  const region = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, (_, x) => (x === 0 ? 0 : x === COLS - 1 ? 1 : -1)));
  for (let y = 0; y < ROWS; y++) for (const x of [0, COLS - 1]) if (cls[y][x] !== 'nwalk') region[y][x] = -1;
  const L: Layout = {
    cols: COLS, rows: ROWS, cls, inP, bx0: LX0, by0: LY0, bx1: LX0 + LW, by1: LY0 + LH, rH: ROAD, rV: ROAD, sw: SW, sw2: SW,
    roadDist: chebDist(cls.map(row => row.map(c => c === 'road'))), shape: 'rect', region,
    regionStyle: ['sidewalk_grey', 'sidewalk_beige'], mainStyle: 'sidewalk_lightgrey',
    segs: findSegs(cls, (_a, w) => w === ROAD), crossings: [],
    base: grid(null), over: grid(null), mark: grid(''),
    topLimit: () => top,
  };
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    if (cls[y][x] === 'road') L.base[y][x] = ['city', 1, 4];
    else paintWalkCell(L, x, y);
  }
  return { layout: L, params: { world: { seed, blockId: 'test', zone: 'res', offset: [0, 0] } } };
}

test('generateBase with a window: no neighbour buildings, deterministic', () => {
  const opts = withDefaults({});
  const a = generateBase('7', opts, testWindow('7'));
  const b = generateBase('7', opts, testWindow('7'));
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.ok(a.buildings!.length > 0, 'the block has buildings');
  for (const bl of a.buildings!) assert.equal(bl.block, 'main');
  assert.deepEqual((a.params as Record<string, unknown>).world, { seed: '7', blockId: 'test', zone: 'res', offset: [0, 0] });
  assert.equal(a.cols, COLS);
  assert.equal(a.rows, ROWS);
});

test('topLimit: no building sprite reaches above the north road centre line', () => {
  const opts = withDefaults({});
  for (let s = 1; s <= 20; s++) {
    const sc = generateBase(String(s), opts, testWindow(String(s)));
    for (const bl of sc.buildings!) assert.ok(bl.rect.y0 / 16 >= NORTH_MID, `seed ${s}: ${bl.id} top row ${bl.rect.y0 / 16} < ${NORTH_MID}`);
  }
});

// the north road centre line does not bind in this small window (the north row's sprites stop at row 4), so the limit is
// also checked where it does: at the lot's top row, the rows behind may not slide north at all (without the limit they do)
test('topLimit binds: a limit at the lot top keeps every sprite on the lot', () => {
  const opts = withDefaults({});
  let bound = 0;
  for (let s = 1; s <= 20; s++) {
    const sc = generateBase(String(s), opts, testWindow(String(s), LY0));
    const free = generateBase(String(s), opts, testWindow(String(s), -1000));
    if (free.buildings!.some(bl => bl.rect.y0 / 16 < LY0)) bound++;
    for (const bl of sc.buildings!) assert.ok(bl.rect.y0 / 16 >= LY0, `seed ${s}: ${bl.id} top row ${bl.rect.y0 / 16} < ${LY0}`);
  }
  assert.ok(bound > 0, 'some seed would put a sprite above the lot without the limit');
});

// no window: generate(seed) unchanged -> covered by the 200-seed regression (scripts/regress.ts compare)
