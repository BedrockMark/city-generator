import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from './rng';
import { modularStack, resetIds, type BuildingPlan } from './buildings';
import { linkBuildings, condoBays, terracedRow } from './terrace';
import { generate } from './generate';
import { expEnabled, withDefaults } from './exp';
import { spr } from './assets';
import type { BlockPlan } from './block';
import { TILE } from './types';

const block = (bs: { plan: BuildingPlan; cx: number; cy: number }[]): BlockPlan =>
  ({ buildings: bs.map(b => ({ ...b, side: 'S' as const, why: '' })), zones: [], yard: [], yb: new Map(), yt: new Map() });
const stack = (seed: string, o: Parameters<typeof modularStack>[1]) => modularStack(new Rng(seed), o);
const links = (b: BuildingPlan) => b.parts.filter(p => p.role === 'link');

test('two touching stacks of one colourway link; a gap or another bottom row does not', () => {
  resetIds();
  const a = stack('a', { colour: 'red', floors: 1, front: 'condo' }), b = stack('b', { colour: 'red', floors: 1, front: 'condo' });
  const n = linkBuildings([block([{ plan: a, cx: 0, cy: 0 }, { plan: b, cx: 7, cy: a.h - b.h }])]);
  assert.equal(n, 1);
  assert.ok(links(a).length >= 2 && links(b).length >= 2, 'ground + middle floor at least');
  // strips lie over A's right column and B's left column, bottom-aligned with the piece they cover
  for (const s of links(a)) assert.equal(s.dx, 6 * TILE);
  for (const s of links(b)) assert.equal(s.dx, 0);
  const c = stack('c', { colour: 'red', floors: 1 }), d = stack('d', { colour: 'red', floors: 1 });
  assert.equal(linkBuildings([block([{ plan: c, cx: 0, cy: 0 }, { plan: d, cx: 8, cy: c.h - d.h }])]), 0);
  assert.equal(linkBuildings([block([{ plan: c, cx: 0, cy: 0 }, { plan: d, cx: 7, cy: c.h - d.h + 1 }])]), 0);
  assert.equal(links(c).length + links(d).length, 0);
});

test('strips are drawn right after the piece they cover', () => {
  resetIds();
  const a = stack('e', { colour: 'blue', floors: 2, front: 'condo' }), b = stack('f', { colour: 'blue', floors: 2, front: 'condo' });
  linkBuildings([block([{ plan: a, cx: 0, cy: 0 }, { plan: b, cx: 7, cy: a.h - b.h }])]);
  a.parts.forEach((p, i) => {
    assert.equal(p.sub, i);
    if (p.role !== 'link') return;
    const q = a.parts[i - 1];   // the piece it covers
    assert.notEqual(q.role, 'link');
    assert.equal(p.dy + spr(p.key).h, q.dy + spr(q.key).h);
  });
});

test('other colourways never link facades', () => {
  resetIds();
  const a = stack('g', { colour: 'red', floors: 1, front: 'condo' }), b = stack('h', { colour: 'grey', floors: 1, front: 'condo' });
  linkBuildings([block([{ plan: a, cx: 0, cy: 0 }, { plan: b, cx: 7, cy: a.h - b.h }])]);
  assert.ok(![...links(a), ...links(b)].some(p => !p.key.includes('Roof')));
});

test('condo bays and terraced rows have the asked width and fit', () => {
  for (const w of [4, 6, 8, 12]) {
    const b = condoBays(new Rng('w' + w), w, 12)!;
    assert.equal(b.w, w);
    assert.equal(b.parts.reduce((s, p) => s + spr(p.key).w, 0), w * TILE);
  }
  assert.equal(condoBays(new Rng('x'), 5, 12), null);
  assert.equal(condoBays(new Rng('x'), 6, 9), null);
  const t = terracedRow(new Rng('t'), 3, 16)!;
  assert.equal(t.w, 30); assert.equal(t.doors.length, 3);
  for (const p of t.parts) assert.equal(p.dy + spr(p.key).h, t.h * TILE);
});

test('exp-04 is adopted: always on, untagged; older versions run without it', () => {
  // seed 1: since exp-05 took twice the buildings (0.7.5), seed 7 has no linked neighbours left; exp-07 is the one
  // experiment on by default, so the master switch changes the picture by it
  const on = generate('1', { exp: { 'exp-07': false } }), x0 = generate('1', { experiments: false, exp: { 'exp-04': false } });
  assert.ok(!on.objects.some(o => o.exp === 'exp-04') && !(on.groups ?? []).some(g => g.exp === 'exp-04'));
  assert.ok(on.objects.some(o => o.reason?.includes('链接条')));
  assert.deepEqual(x0.objects.map(o => [o.key, o.x, o.y]), on.objects.map(o => [o.key, o.x, o.y]));
  assert.equal(expEnabled(withDefaults({ asOf: '0.7.1' }), 'exp-04'), false);
  assert.equal(expEnabled(withDefaults({ experiments: false }), 'exp-04'), true);
});
