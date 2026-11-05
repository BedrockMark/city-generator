import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../generate';
import { signature } from '../signature';
import { noveltyFactors, markNovel } from './novelty';
import type { Placed, Scene } from '../types';
import { MODULAR } from '../assets';
import { featureMatrix, windows, activeFeatures } from '../judge/features';
import { scoreWorld, MODEL } from '../judge/model';
import { alignScene, type JGround, type JObj, type JWorld } from '../judge/align';
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
  let nv = 0, all = 0, jn = 0, jall = 0;
  for (let s = 1; s <= 20; s++) {
    const sc = generate(String(s), { novelty: 0.1 }), w = alignScene(sc);
    nv += sc.objects.filter(o => o.novel).length; all += sc.objects.length;
    jn += w.objs.filter(o => o.novel).length; jall += w.objs.length;
  }
  console.log(`novel at 0.1, seeds 1-20: all ${nv} / ${all} = ${(100 * nv / all).toFixed(1)}%, judge objects ${jn} / ${jall} = ${(100 * jn / jall).toFixed(1)}%`);
  assert.ok(nv / all < 0.05, `all ${nv} / ${all}`);
  assert.ok(jn / jall < 0.05, `judge ${jn} / ${jall}`);   // what d.* / p.* leave out
});

test('judge ignores novel objects in density', () => {
  const ground = Array.from({ length: 8 }, () => Array.from({ length: 8 }, (): JGround => 'paved'));
  const obj = (fx: number, fy: number, novel?: boolean): JObj => ({ key: 'k', cls: 'tree', fx, fy, bb: { x0: fx - 4, y0: fy - 12, x1: fx + 4, y1: fy }, ...(novel ? { novel } : {}) });
  const mk = (objs: JObj[]): JWorld => ({ name: 't', src: 'gen', cols: 8, rows: 8, ox: 0, oy: 0, ground, objs });
  const a = mk([obj(20, 30)]), b = mk([obj(20, 30), obj(100, 100, true)]);
  const feats = activeFeatures([]), row = (w: JWorld) => featureMatrix(w, windows(w), feats)[0];
  const ra = row(a), rb = row(b), at = (r: number[], id: string) => r[feats.findIndex(f => f.id === id)];
  for (const f of feats) if (f.id.startsWith('d.') || f.id.startsWith('p.')) assert.equal(at(rb, f.id), at(ra, f.id), f.id);
  assert.notEqual(at(rb, 'e.far'), at(ra, 'e.far'), 'e.* still sees the novel object');
});

test('threshold relaxes with novelty', () => {
  const w: JWorld = { name: 't', src: 'gen', cols: 0, rows: 0, ox: 0, oy: 0, ground: [], objs: [] };
  assert.equal(scoreWorld(w, MODEL, 0.5).threshold, MODEL.threshold + 0.1);
  assert.equal(scoreWorld(w, MODEL).threshold, MODEL.threshold);
});
