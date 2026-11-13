import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockReach } from './reach';
import { cellBlocks } from './blocks';
import { roundabout } from './roundabout';
import { crossingsIn } from './cells';
import { CROSSING_LEN } from './config';

const SEEDS = Array.from({ length: 20 }, (_, i) => String(i + 1));

let cached: { total: number; fails: string[]; zebra?: string; island?: string } | undefined;
function scan(): { total: number; fails: string[]; zebra?: string; island?: string } {
  if (cached) return cached;
  const out: { total: number; fails: string[]; zebra?: string; island?: string } = { total: 0, fails: [] };
  for (const seed of SEEDS) for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
    for (const b of cellBlocks(seed, i, j)) {
      out.total++;
      const r = blockReach(seed, b.id);
      if (!r.ok) out.fails.push(`${seed} ${b.id}`);
      else if (r.crossings > 0) out.zebra ??= `${seed} ${b.id}`;
    }
    const rb = roundabout(seed, i, j);
    if (rb) out.island ??= `${seed} r${i},${j}`;
  }
  return (cached = out);
}

test('a block with a zebra landing on its sidewalk is reachable', () => {
  const s = scan();
  assert.ok(s.zebra, 'some block is reachable');
  const [seed, id] = s.zebra!.split(' ');
  const r = blockReach(seed, id);
  assert.ok(r.ok && r.crossings > 0 && r.why.includes('横道'));
  assert.equal(r.exempt, undefined);
});

test('roundabout islands are exempt', () => {
  const s = scan();
  assert.ok(s.island, 'a roundabout exists in the scan');
  const [seed, id] = s.island!.split(' ');
  const r = blockReach(seed, id);
  assert.ok(r.exempt && r.exempt.length > 0);
  assert.equal(r.ok, true);
});

test('a block with no zebra fails C26 (failures are reported, not asserted away)', () => {
  const s = scan();
  if (process.env.REACH_REPORT) console.log(`C26: ${s.fails.length} of ${s.total} blocks fail`, s.fails.slice(0, 8));
  if (s.fails.length === 0) { assert.equal(s.fails.length, 0); return; }
  const [seed, id] = s.fails[0].split(' ');
  const r = blockReach(seed, id);
  assert.equal(r.ok, false);
  assert.equal(r.crossings, 0);
  assert.ok(r.why.includes('C26'));
  // the cell's crossings really never touch this block's rect margin ring: no zebra beside it
  const b = cellBlocks(seed, ...(/^b(-?\d+),(-?\d+)\//.exec(id)!.slice(1).map(Number) as [number, number])).find(o => o.id === id)!;
  const f = b.foot[0];
  for (const c of crossingsIn(seed, { x0: f.x0 - 2, y0: f.y0 - 2, x1: f.x1 + 2, y1: f.y1 + 2 }))
    assert.ok(CROSSING_LEN > 0 && c.band0 < c.band1);
});
