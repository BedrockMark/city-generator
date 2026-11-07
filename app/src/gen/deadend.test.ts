import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from './generate';
import { rationalize } from './rational/rationalize';
import { expEnabled, withDefaults } from './exp';

// exp-07 (C25) on the pictures the user labelled (v0.7.4, exp-05 + exp-06 on): the audit re-run with exp-07 on
const labelled = (seed: string, novelty: number) => {
  const o = { novelty, asOf: '0.7.4', exp: { 'exp-05': true, 'exp-06': true } };
  const sc = generate(seed, o as never);
  sc.audit = rationalize(sc, withDefaults({ ...o, asOf: undefined }));
  return sc;
};

test('464294 L1: the garden path from wall to wall is continued at both ends (north sidewalk, south paving)', () => {
  const sc = labelled('464294', 0.1);
  const links = sc.zones!.filter(z => z.kind === 'link' && z.gid === 'garden#1');
  assert.ok(links.length >= 2 && links.every(z => z.exp === 'exp-07'));
  const path = sc.zones!.find(z => z.kind === 'path' && z.gid === 'garden#1')!;
  assert.ok(path.rect.x1 <= 480, 'the stretch under the red building is gone');
  assert.equal(sc.audit!.counts.C25, 0);
  assert.ok(!sc.audit!.violations.some(v => v.c === 'C19' && v.msg.includes('garden#1')));
  assert.ok(sc.audit!.regrounded.some(g => g.c === 'C25' && g.what === 'pave' && g.exp === 'exp-07'));
});

test('271666 L1: the bin in the way of the alley goes (it meets a passage under the building to the east sidewalk)', () => {
  const sc = labelled('271666', 0.9);
  assert.ok(sc.audit!.pruned.some(p => p.c === 'C25' && /Trashbin/.test(p.key) && p.exp === 'exp-07'));
  assert.ok(!sc.objects.some(o => o.gid === 'alley#0' && /Trashbin/.test(o.key)));
  assert.equal(sc.audit!.counts.C25, 0);
});

test('exp-07 is an experiment, on by default: off (or before 0.7.5) the constraint is not judged and nothing carries its tag', () => {
  assert.equal(expEnabled(withDefaults({}), 'exp-07'), true);
  assert.equal(expEnabled(withDefaults({ asOf: '0.7.4' }), 'exp-07'), false);
  const off = generate('6', { exp: { 'exp-07': false } });
  assert.equal(off.audit!.counts.C25, undefined);
  assert.ok(!off.zones!.some(z => z.exp === 'exp-07'));
  const on = generate('6');
  assert.ok(on.audit!.regrounded.some(g => g.c === 'C25'));
});

// v0.7.5 labels (default options): paths that run on under upper floors to a sidewalk are passages, not dead ends
test('887735 L1, 389673 L1, 254889 L1: a path hidden under upper floors that comes out on a sidewalk is left alone', () => {
  // the labelled cell: still on a path, no C25 repair over it
  for (const [seed, x, y] of [['887735', 792, 408], ['389673', 616, 504], ['254889', 360, 376]] as const) {
    const sc = generate(seed);
    const at = (r: { x0: number; y0: number; x1: number; y1: number }) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;
    assert.ok(sc.zones!.some(z => z.kind === 'path' && at(z.rect)), `${seed}: path kept`);
    assert.ok(!sc.audit!.regrounded.some(g => g.c === 'C25' && at(g.rect)), `${seed}: not repaired`);
  }
});

test('254889 L2, 290342 L1, 865057 L3: the meaningless alley and the dead paths go, hidden ones too', () => {
  assert.ok(generate('254889').audit!.downgraded.some(d => d.c === 'C25' && d.kind === 'alley'));
  const b = generate('290342');
  assert.ok(!b.zones!.some(z => z.kind === 'path'), 'no garden path left, under the buildings neither');
  assert.equal(b.audit!.counts.C19, 0);
  assert.ok(!generate('865057').zones!.some(z => z.kind === 'path' && z.gid === 'garden#1'));
});

test('865057 L1, L2: the alley goes through, its dumpsters out of the way; the path joining it stays', () => {
  const sc = generate('865057');
  // the one labelled (in the way from the street to the path joining the alley); the one in the nook past it stays
  assert.ok(!sc.objects.some(o => o.gid === 'alley#1' && /Dumpster/.test(o.key) && o.x === 401 && o.y === 384));
  assert.ok(sc.zones!.some(z => z.kind === 'path' && z.gid === 'garden#0'));
});

// third round (v0.7.5 labels): no meaningless links, hidden destinations
test('329528 L1, 447731 L2: no hairpin link in a little garden; a path beside an alley is not continued', () => {
  assert.ok(!generate('329528').zones!.some(z => z.gid === 'garden#1' && (z.kind === 'path' || z.kind === 'link')));
  const b = generate('447731');
  assert.ok(!b.zones!.some(z => z.gid === 'garden#0' && (z.kind === 'path' || z.kind === 'link')));
  assert.ok(b.zones!.some(z => z.gid === 'alley#0' && z.kind === 'link'), '447731 L1: the alley goes on to the parking lot');
});

test('849873 L1, 268172 L1, 173387 L2: a parking lot under upper floors is somewhere, a junk corner wholly under them is not', () => {
  // the path from the sidewalk under the building to the parking lot stays (joined to the lot under the upper floors)
  const a = generate('849873');
  assert.ok(a.zones!.some(z => z.gid === 'garden#0' && z.kind === 'path' && z.rect.x0 === 256));
  assert.ok(!a.audit!.regrounded.some(g => g.c === 'C25' && g.what === 'lawn' && g.msg.includes('（garden#0）')));
  assert.ok(generate('268172').zones!.some(z => z.gid === 'garden#1' && z.kind === 'link'));
  assert.ok(generate('173387').audit!.downgraded.some(d => d.c === 'C25' && d.kind === 'alley'));
});
