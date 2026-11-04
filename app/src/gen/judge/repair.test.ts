import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectTargets, saltableStreams, qualifies, degradeWindow, stillNeeded, type Cand, type Target } from './repair';
import { generate, generateBase } from '../generate';
import { withDefaults } from '../exp';
import { signature } from '../signature';
import type { JudgeResult, JudgeWin } from './model';
import type { Audit } from '../rational/rationalize';
import type { PxRect, Scene, Placed } from '../types';

const R = (c0: number, r0: number): PxRect => ({ x0: c0 * 16, y0: r0 * 16, x1: (c0 + 8) * 16, y1: (r0 + 8) * 16 });
const W = (c0: number, r0: number, score: number): JudgeWin => ({ rect: R(c0, r0), score, top: [] });
const J = (ws: JudgeWin[]): JudgeResult => ({ model: 't', threshold: 0.5, windows: ws, mean: ws.reduce((a, w) => a + w.score, 0) / ws.length, max: Math.max(...ws.map(w => w.score)) });
const emptyAudit = { counts: {}, before: {}, violations: [], pruned: [], downgraded: [], regrounded: [], applied: [], graph: {}, emptyGroups: [] } as unknown as Audit;

test('selectTargets picks non-overlapping windows, at most 3', () => {
  const j = J([W(0, 0, 0.9), W(4, 0, 0.95), W(8, 0, 0.8), W(16, 0, 0.7), W(24, 0, 0.6), W(32, 0, 0.4)]);
  const t = selectTargets(j, emptyAudit, 0.5);
  assert.deepEqual(t.map(x => x.rect.x0 / 16), [4, 16, 24]);
  assert.ok(t.every(x => x.why === 'score'));
});

test('selectTargets adds windows holding report-only violations', () => {
  const j = J([W(0, 0, 0.2), W(8, 0, 0.3)]);
  const au = { ...emptyAudit, violations: [{ c: 'C19', target: 'z3', objs: [], rect: { x0: 140, y0: 20, x1: 150, y1: 40 }, msg: '' }, { c: 'C05', target: 'o1', objs: [], rect: { x0: 10, y0: 10, x1: 20, y1: 20 }, msg: '' }] } as unknown as Audit;
  const t = selectTargets(j, au, 0.5);
  assert.equal(t.length, 1);
  assert.equal(t[0].why, 'C19');
  assert.equal(t[0].rect.x0, 128);
});

test('saltableStreams excludes structural streams', () => {
  const o = (stream: string, x: number): Placed => ({ kind: 'sprite', key: '3_City_Props/Street_Lamp_1', file: '', x, y: 10, w: 16, h: 48, foot: 58, cls: 'lamp', stream });
  const sc = { objects: ['curb/curbS3', 'yard', 'layout', 'exp/exp-01/roof:b1', 'block', 'neigh'].map((s, i) => o(s, 10 + i * 10)),
    zones: [{ id: 'z1', layer: 'yard', kind: 'garden', rect: { x0: 0, y0: 0, x1: 64, y1: 64 }, reason: '', stream: 'yard/garden3,4' }, { id: 'z2', layer: 'yard', kind: 'garden', rect: { x0: 500, y0: 0, x1: 564, y1: 64 }, reason: '', stream: 'yard/garden30,4' }] } as unknown as Scene;
  assert.deepEqual(saltableStreams(sc, R(0, 0)).sort(), ['curb/curbS3', 'yard/garden3,4']);
});

const cand = (ws: JudgeWin[], violations: number, extra: Partial<Cand> = {}): Cand => ({ scene: { audit: emptyAudit } as unknown as Scene, judge: J(ws), violations, reseed: {}, ...extra });
const target: Target = { rect: R(0, 0), score: 0.9, why: 'score' };
const orig = cand([W(0, 0, 0.9), W(8, 0, 0.5), W(16, 0, 0.5)], 2);

test('qualifies rejects more violations', () => {
  assert.equal(qualifies(orig, cand([W(0, 0, 0.3), W(8, 0, 0.5), W(16, 0, 0.5)], 3), target).ok, false);
});
test('qualifies rejects a worse outside', () => {
  // outside tolerance = 0.05 x 2 windows = 0.1; outside got worse by 0.2
  assert.equal(qualifies(orig, cand([W(0, 0, 0.3), W(8, 0, 0.6), W(16, 0, 0.6)], 2), target).ok, false);
});
test('qualifies rejects a target that did not improve', () => {
  assert.equal(qualifies(orig, cand([W(0, 0, 0.9), W(8, 0, 0.5), W(16, 0, 0.5)], 2), target).ok, false);
});
test('qualifies accepts a better target within tolerance', () => {
  assert.equal(qualifies(orig, cand([W(0, 0, 0.4), W(8, 0, 0.55), W(16, 0, 0.5)], 2), target).ok, true);
});

test('exp-02 off gives the base picture', () => {
  assert.deepEqual(signature(generate('7', { exp: { 'exp-02': false } })), signature(generateBase('7', withDefaults({}))));
});

test('degradeWindow never adds objects', () => {
  const sc = generateBase('7', withDefaults({}));
  const n = sc.objects.length;
  for (const z of (sc.zones ?? []).filter(z => z.layer === 'yard').slice(0, 3)) degradeWindow(sc, z.rect);
  assert.ok(sc.objects.length <= n);
});

test('repaired scene reproduces from its options', () => {
  let sc: Scene | undefined;
  for (let s = 1; s <= 30 && !sc; s++) { const g = generate(String(s)); if (g.judgeRepair?.windows.some(w => w.adopted !== undefined || (w.degraded && w.degraded !== 'rejected'))) sc = g; }
  assert.ok(sc, 'some seed in 1..30 is repaired');
  const again = generate(sc!.seed, sc!.options);
  assert.deepEqual(signature(again), signature(sc!));
  assert.equal(again.judgeRepair, undefined, 'no search when the options carry the result');
});

test('a recorded downgrade changes something and lowers the window score', () => {
  // seed 134 used to record a downgrade that left its window at 0.84 -> 0.84
  for (const s of ['134', '1', '2']) {
    const r = generate(s).judgeRepair;
    for (const w of r?.windows ?? []) if (w.degraded && w.degraded !== 'rejected') {
      assert.ok(w.degraded.zones.length + w.degraded.removed.length > 0, `seed ${s}`);
      assert.ok(w.after < w.before, `seed ${s}: ${w.before} -> ${w.after}`);
    }
  }
});

test('stillNeeded: a window fixed meanwhile is skipped', () => {
  const c = cand([W(0, 0, 0.4), W(8, 0, 0.9)], 0);
  assert.equal(stillNeeded(c, { rect: R(0, 0), score: 0.9, why: 'score' }, 0.5), false);
  assert.equal(stillNeeded(c, { rect: R(8, 0), score: 0.9, why: 'score' }, 0.5), true);
  assert.equal(stillNeeded(c, { rect: R(0, 0), score: 0.4, why: 'C19' }, 0.5), false, 'no C19 violation left in the window');
});
