import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../generate';
import { signature } from '../signature';
import { noveltyFactors, markNovel } from './novelty';
import type { Placed, Scene } from '../types';
import { MODULAR } from '../assets';
import usageRaw from '../data/usage.json';
import spritesRaw from '../data/sprites.json';

const usage = usageRaw as { counts: Record<string, number>; max: number };
const keys = Object.keys(spritesRaw);
const cnt = (k: string) => usage.counts[k] ?? 0;

test('novelty 0 changes nothing', () => {
  for (const s of ['1', '2', '3', '4', '5']) {
    const a = generate(s, { novelty: 0, prefs: false }), b = generate(s, { novelty: 0 });
    assert.deepEqual(signature(a), signature(b), `seed ${s}`);
    assert.ok(!b.objects.some(o => o.novel), `seed ${s} has novel objects`);
  }
});

test('rare sprites are picked more at high novelty', () => {
  const top = keys.reduce((a, k) => cnt(k) > cnt(a) ? k : a, keys[0]);
  const rare = keys.find(k => cnt(k) === 0)!;
  assert.equal(cnt(top), usage.max);
  const f1 = noveltyFactors(1, [top, rare])!;
  assert.ok(Math.abs(f1.w[1] / f1.w[0] - 4) < 1e-9, `ratio ${f1.w[1] / f1.w[0]}`);
  assert.deepEqual(f1.novel, [rare]);
  const f5 = noveltyFactors(0.5, [top, rare])!;
  assert.ok(Math.abs(f5.w[1] / f5.w[0] - 2.5) < 1e-9);
  assert.equal(noveltyFactors(1, ['red', '3', 'true']), null);
});

test('novel objects are marked', () => {
  const sc = generate('7', { novelty: 1 });
  const nv = sc.objects.filter(o => o.novel);
  assert.ok(nv.length >= 1, 'no novel objects');
  for (const o of nv) assert.equal(cnt(o.key), 0, o.key);
});

test('each novel pick marks one object', () => {
  const o = (key: string, stream: string) => ({ key, stream, kind: 'sprite', x: 0, y: 0, w: 16, h: 16, foot: 0, cls: 'x' }) as Placed;
  const fam = 'Ground_Floor_Shop', piece = MODULAR[fam][0].key;
  const sc = { objects: [o('k', 'a'), o('k', 'b'), o('k', 'a'), o('k', 'a'), o(piece, 'a'), o(piece, 'a')] } as unknown as Scene;
  markNovel(sc, ['a|k', 'a|k', `a|${fam}`]);
  assert.deepEqual(sc.objects.map(x => !!x.novel), [true, false, true, false, true, false]);
});

test('few objects are novel at the default novelty', () => {
  // was 43% of all objects when every count-0 pick was marked; now only picks the novelty changed
  let nv = 0, all = 0;
  for (let s = 1; s <= 20; s++) {
    const sc = generate(String(s), { novelty: 0.1 });
    nv += sc.objects.filter(o => o.novel).length; all += sc.objects.length;
  }
  console.log(`novel at 0.1, seeds 1-20: ${nv} / ${all} = ${(100 * nv / all).toFixed(1)}%`);
  assert.ok(nv / all < 0.05, `all ${nv} / ${all}`);
});
