import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, generateBase } from '../generate';
import { withDefaults } from '../exp';
import { signature } from '../signature';
import { violationCount, GLOBAL_SALTS } from './repair';

const ON = { exp: { 'exp-02': true } };

test('整体修图 (exp-02) is off by default and then gives the base picture', () => {
  const sc = generate('7');
  assert.equal(sc.judgeRepair, undefined);
  assert.deepEqual(signature(sc), signature(generateBase('7', withDefaults({}))));
});

test('整体修图 keeps the constraints no worse and reproduces from its options', () => {
  // seed 2 at novelty 0 (the stage 6 picture): one of its re-packs leaves more violations than the original, another
  // one is adopted. exp-07 off: it clears nearly all dead-end paths (C19), after which no re-pack is worse
  const base = generate('2', { novelty: 0, exp: { 'exp-07': false } });
  const sc = generate('2', { exp: { 'exp-02': true, 'exp-07': false }, novelty: 0 });
  const r = sc.judgeRepair!;
  assert.ok(r.global && r.global.length === GLOBAL_SALTS, `tried ${GLOBAL_SALTS} re-packs`);
  assert.ok(violationCount(sc.audit) <= violationCount(base.audit));
  for (const g of r.global) assert.equal(g.ok, g.violations <= violationCount(base.audit), `salt ${g.salt}`);
  assert.ok(r.global.some(g => !g.ok), 'some re-pack is rejected');
  assert.ok(r.globalAdopted !== undefined, 'seed 2 adopts a re-pack');
  assert.equal(sc.options!.reseed!.block, r.globalAdopted);
  assert.ok(r.meanAfter < r.meanBefore);
  assert.ok(sc.objects.filter(o => o.cls !== 'building' && !/^(neigh|nfronts|island)/.test(o.stream ?? '')).every(o => o.exp));
  const again = generate('2', sc.options);
  assert.deepEqual(signature(again), signature(sc));
  assert.equal(again.judgeRepair, undefined, 'no search when the options carry the result');
});

test('the adopted re-pack has the lowest mean among the qualifying ones', () => {
  const r = generate('3', ON).judgeRepair!;
  const ok = (r.global ?? []).filter(g => g.ok);
  if (r.globalAdopted === undefined) assert.ok(ok.every(g => g.mean >= r.meanBefore));
  else assert.equal(Math.min(...ok.map(g => g.mean)), r.meanAfter);
});
