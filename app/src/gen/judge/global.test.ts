import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../generate';
import { violationCount } from './repair';

test('global tier off by default', () => {
  assert.equal(generate('8').judgeRepair?.global, undefined);
});

test('global tier respects condition 1', () => {
  // seed 1: two of its four re-packs leave more violations than the original
  const base = generate('1', { exp: { 'exp-02': false } });
  const sc = generate('1', { judgeGlobal: true });
  const r = sc.judgeRepair!;
  assert.ok(r.global && r.global.length === 4, 'global tier ran 4 candidates');
  assert.ok(violationCount(sc.audit) <= violationCount(base.audit));
  for (const g of r.global) assert.equal(g.ok, g.violations <= violationCount(base.audit), `salt ${g.salt}`);
  assert.ok(r.global.some(g => !g.ok), 'some re-pack is rejected');
  if (r.globalAdopted !== undefined) {
    assert.equal(sc.options!.reseed!.block, r.globalAdopted);
    assert.ok(sc.objects.filter(o => o.cls !== 'building' && !/^(neigh|nfronts|island)/.test(o.stream ?? '')).every(o => o.exp));
  }
});
