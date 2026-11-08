import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from './generate';
import { overlaps } from './place';
import { mixDistrict } from '../viewer/mix';

test('exp-09 palace: garden round the back, drop-off and lawn / plaza in front, untagged (adopted 0.7.9.1), nothing repaired away', () => {
  for (const seed of ['1', '2', '3', '4', '5', '6', '7', '8']) {
    const sc = generate(seed, { district: 'palace' });
    const at = `palace seed ${seed}`;
    const pal = sc.buildings!.find(b => b.front === 'landmark')!;
    assert.ok(pal, `${at}: palace placed`);
    assert.equal(sc.buildings!.filter(b => b.block === 'main').length, 1, `${at}: no other buildings on the block`);
    const mine = sc.objects.filter(o => /^palace/.test(o.gid ?? '') || o.gid === pal.gid);
    assert.ok(!sc.objects.some(o => o.exp) && !sc.zones!.some(z => z.exp) && !sc.groups!.some(g => g.exp), `${at}: nothing tagged (exp-09 adopted)`);
    const keys = mine.map(o => o.key);
    // the modular porch, the garden wall with its gate, the greenhouse, the drop-off car
    assert.ok(keys.some(k => /Palace_[12]_Entrance_Variant_[123]$/.test(k)), `${at}: porch`);
    assert.ok(keys.filter(k => /Grass_Wall_2_/.test(k)).length > 50, `${at}: garden wall`);
    // second round (user 2026-11-08): each seed some of pool / maze / playground / greenhouse; no empty pieces; 2-3 blocks
    const types = new Set(sc.groups!.map(g => g.type));
    assert.ok(['palace-pool', 'palace-maze', 'palace-playground', 'palace-greenhouse'].some(t => types.has(t)), `${at}: a feature (${[...types].join(', ')})`);
    for (const g of sc.groups!) if (/^palace-(room|pool|maze|playground|greenhouse|shed|court)$/.test(g.type))
      assert.ok(sc.objects.some(o => o.gid === g.gid && o.cls !== 'fence'), `${at}: ${g.gid} has something in it`);
    const [w, h] = sc.params.interior as number[];
    assert.ok(w * h >= 1700 && w * h <= 2900, `${at}: ${w}x${h} = ${w * h} cells (2-3 ordinary blocks)`);
    assert.ok(mine.some(o => o.cls === 'vehicle' && o.gid?.startsWith('palace-dropoff')), `${at}: a car at the stair`);
    assert.equal(sc.zones!.filter(z => z.kind === 'driveway' && z.gid?.startsWith('palace-dropoff')).length, 2, `${at}: in and out driveways`);
    assert.ok(sc.groups!.some(g => g.type === 'palace-lawn' || g.type === 'palace-plaza'), `${at}: lawn or fountain plaza outside the drive`);
    // the garden is behind the palace (north of its footprint) and beside it
    const garden = sc.zones!.filter(z => z.kind === 'palace-garden');
    assert.ok(garden.some(z => z.rect.y1 <= pal.solid.y0) && garden.some(z => z.rect.x1 <= pal.solid.x0) && garden.some(z => z.rect.x0 >= pal.solid.x1), `${at}: garden behind and on both sides`);
    // nothing stands on the palace or the stair (the hedges and props keep off its footprint)
    for (const o of mine) if (o.cls !== 'building' && o.fp && o.kind === 'sprite') assert.ok(!overlaps(o.fp, pal.solid), `${at}: ${o.key} off the palace`);
    // the repairs leave the campus alone
    const a = sc.audit!;
    assert.ok(!a.pruned.some(p => /^palace|^bld:L/.test(p.gid ?? '')), `${at}: no palace objects repaired away`);
    assert.ok(!a.downgraded.some(d => /^palace/.test(sc.zones!.find(z => z.id === d.zone)?.gid ?? '')), `${at}: no palace area downgraded`);
  }
});

test('palace: menu only, the viewer mix never draws it', () => {
  for (let i = 0; i < 2000; i++) assert.notEqual(mixDistrict(String(i)), 'palace');
});
