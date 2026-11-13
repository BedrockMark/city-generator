import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockReach } from './reach';
import { blockById, cellBlocks } from './blocks';
import { roundabout } from './roundabout';
import { crossingsIn } from './cells';
import { CROSSING_LEN } from './config';

// A small scan (the 20-seed C26 count lives in cityregress): 4 seeds x [-1, 1]^2 cells, stopped once a reachable
// block and a failing block are both found.
const SEEDS = ['1', '2', '3', '4'];

interface Scan { total: number; fails: string[]; zebra?: string }
let cached: Scan | undefined;
function scan(): Scan {
  if (cached) return cached;
  const out: Scan = { total: 0, fails: [] };
  scanning: for (const seed of SEEDS) for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    for (const b of cellBlocks(seed, i, j)) {
      out.total++;
      const r = blockReach(seed, b.id);
      if (!r.ok) out.fails.push(`${seed} ${b.id}`);
      else if (r.crossings > 0) out.zebra ??= `${seed} ${b.id}`;
      if (out.fails.length && out.zebra) break scanning;
    }
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
  for (const seed of SEEDS) for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) {
    if (!roundabout(seed, i, j)) continue;
    const r = blockReach(seed, `r${i},${j}`);
    assert.ok(r.exempt && r.exempt.length > 0);
    assert.equal(r.ok, true);
    return;
  }
  assert.fail('no roundabout found in the scan');
});

test('a block with no zebra fails C26 (when the scan finds one)', () => {
  const s = scan();
  if (s.fails.length === 0) { assert.equal(s.fails.length, 0); return; }
  const [seed, id] = s.fails[0].split(' ');
  const r = blockReach(seed, id);
  assert.equal(r.ok, false);
  assert.equal(r.crossings, 0);
  assert.ok(r.why.includes('C26'));
  // no crossing around the block lands on its sidewalk
  const b = blockById(seed, id), L = CROSSING_LEN;
  const inFoot = (x: number, y: number) => b.foot.some(f => x >= f.x0 && x < f.x1 && y >= f.y0 && y < f.y1);
  const f = b.foot[0];
  for (const c of crossingsIn(seed, { x0: f.x0 - 3, y0: f.y0 - 3, x1: f.x1 + 3, y1: f.y1 + 3 }))
    for (let p = c.at; p < c.at + L; p++) for (const k of [c.band0 - 1, c.band1])
      assert.ok(!(c.axis === 'h' ? inFoot(p, k) : inFoot(k, p)), `${id}: a crossing lands in its footprint`);
});
