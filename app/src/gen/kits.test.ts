import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from './rng';
import { condo3, condo4Row, condo4Tower, condo7Row, office, hotel, EXP05 } from './kits';
import { generate } from './generate';
import { spr } from './assets';
import type { BuildingPlan } from './buildings';
import { TILE } from './types';

/** every piece lies inside the building's rect, the structural pieces cover it to the bottom edge, doors are on it */
function sane(b: BuildingPlan) {
  for (const p of b.parts) {
    const s = spr(p.key);
    assert.ok(p.dx >= 0 && p.dy >= 0 && p.dx + s.w <= b.w * TILE && p.dy + s.h <= b.h * TILE, `${b.label}: ${p.key} at ${p.dx},${p.dy} outside ${b.w}x${b.h}`);
  }
  b.parts.forEach((p, i) => assert.equal(p.sub, i));
  for (const d of b.doors) assert.ok(d > 0 && d < b.w * TILE, `${b.label}: door ${d}`);
  assert.ok(b.foot >= 3 && b.foot <= b.h);
  assert.equal(b.exp, EXP05);
  assert.ok(/^k\d+$/.test(b.id), 'kit buildings number apart (D23)');
}

test('kit sizes follow their grammar', () => {
  const r = new Rng('kits');
  for (const w of [5, 6, 9, 14]) { const b = condo3(r, w)!; sane(b); assert.equal(b.w, w); assert.equal(b.h, 11); }
  assert.equal(condo3(r, 4), null);
  for (const [m, n] of [[0, 0], [1, 1], [3, 2]]) { const b = condo4Row(r, m, n); sane(b); assert.equal(b.w, 12 + 4 * m); assert.equal(b.h, 15 + 3 * n); assert.equal(b.doors.length, 2); }
  for (const n of [0, 2]) { const b = condo4Tower(n); sane(b); assert.equal(b.w, 6); assert.equal(b.h, 13 + 3 * n); }
  for (const k of [2, 4]) { const b = condo7Row(r, k, 18)!; sane(b); assert.equal(b.w, 3 * k); assert.equal(b.doors.length, k); assert.ok(b.h <= 18); }
  assert.equal(condo7Row(r, 2, 11), null);
  for (const [k, f] of [[1, 1], [2, 2], [4, 5]]) { const b = office(r, k, f); sane(b); assert.equal(b.w, 4 + 3 * k); assert.equal(b.h, 5 + 3 * (f + 1)); assert.equal(b.front, 'office'); }
  for (const [n, e] of [[0, 0], [2, 1]]) { const b = hotel(n, e); sane(b); assert.equal(b.w, 17); assert.equal(b.h, 18 + e + 4 * n); assert.equal(b.front, 'hotel'); }
});

test('the body pieces of a kit stack without gaps (Condo_4, hotel, office)', () => {
  const rows = (b: BuildingPlan, keyRx: RegExp) => {
    const cov = Array<boolean>(b.h).fill(false);
    for (const p of b.parts) if (keyRx.test(p.key)) for (let y = p.dy / TILE; y < (p.dy + spr(p.key).h) / TILE; y++) cov[y] = true;
    return cov.every(Boolean);
  };
  assert.ok(rows(condo4Row(new Rng('a'), 1, 2), /Condo_4_(1|2|3|5|6|7|10|11|12)$/));
  assert.ok(rows(hotel(2, 2), /Hotel_Modular/));
  assert.ok(rows(office(new Rng('b'), 2, 4), /Roof_(Left|Middle_Modular|Stairs)|Building_\d_(Left|Middle_Modular|Right)$/));
  assert.ok(rows(office(new Rng('c'), 2, 3), /Roof_(Left|Middle_Modular|Stairs)|Building_\d_(Left|Middle_Modular|Right)$/));
});

test('exp-05 off leaves the picture as it was; on, its buildings carry the tag', () => {
  for (const seed of ['1', '4']) {
    const off = generate(seed, { judgeRepair: false } as never), off2 = generate(seed, { judgeRepair: false, exp: { 'exp-05': false } } as never);
    assert.equal(JSON.stringify(off.objects), JSON.stringify(off2.objects));
    const on = generate(seed, { judgeRepair: false, exp: { 'exp-05': true } } as never);
    const kits = on.buildings!.filter(b => /^k\d+$/.test(b.id));
    assert.ok(kits.length > 0, `seed ${seed} has kit buildings (found in the 200-seed run)`);
    for (const k of kits) assert.equal(on.groups!.find(g => g.gid === k.gid)?.exp, EXP05);
    assert.ok(!off.buildings!.some(b => /^k\d+$/.test(b.id)));
  }
});
