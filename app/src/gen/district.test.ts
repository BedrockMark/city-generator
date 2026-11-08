import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from './generate';
import { DISTRICT_KINDS, EXP08, type DistrictKind } from './district';
import { overlaps } from './place';

/** what each district must have besides its landmark (user 2026-11-07) */
const MUST: Record<DistrictKind, (keys: string[]) => boolean> = {
  school: k => k.some(x => /Basketball_Court|Soccer_Court/.test(x)),
  hospital: k => k.some(x => x.includes('Helicopter_Landing_Pad')),
  police: k => k.filter(x => /Police_Car_[34]|Car_Down/.test(x)).length >= 3 && k.some(x => x.includes('Automatic_Barrier')),
  fire: k => k.some(x => x.includes('Fire_Truck')),
  mall: k => k.some(x => x.includes('Underground_Parking')) && k.some(x => x.includes('Billboard')),
  hotel: k => k.some(x => x.includes('Underground_Parking')),
};

test('exp-08: the landmark footprint is on the lot north edge, the block is its campus, no ordinary buildings packed', () => {
  for (const d of DISTRICT_KINDS) for (const seed of ['1', '2', '3']) {
    const sc = generate(seed, { district: d });
    const at = `${d} seed ${seed}`;
    assert.equal(sc.params.district, d, at);
    const main = sc.buildings!.find(b => b.front === 'landmark');
    assert.ok(main, `${at}: landmark placed`);
    // the lot's first row is right below the north sidewalk: the footprint's top row has sidewalk above it
    const top = main!.solid.y0 / 16, cx = Math.floor((main!.solid.x0 + main!.solid.x1) / 32);
    assert.equal(sc.cells[top][cx], 'lot', at);
    assert.equal(sc.cells[top - 1][cx], 'walk', `${at}: footprint reaches the lot's north edge`);
    // only the campus's own buildings on the main block (the hospital's convenience store is one)
    const others = sc.buildings!.filter(b => b.block === 'main' && b.front !== 'landmark');
    assert.ok(others.length <= (d === 'hospital' ? 1 : 0), `${at}: ordinary buildings ${others.map(b => b.label)}`);
    for (const b of others) assert.ok(!overlaps(b.solid, main!.solid), `${at}: ${b.id} stands clear of the landmark`);
    const keys = sc.objects.filter(o => o.exp === EXP08).map(o => o.key);
    assert.ok(MUST[d](keys), `${at}: campus features (${[...new Set(keys.map(k => k.split('/')[1]))].join(', ')})`);
    assert.ok(sc.objects.filter(o => o.gid === main!.gid).every(o => o.exp === EXP08), `${at}: landmark sprite tagged`);
    // the fire engine waits beside the station, not in front of its garages and door (user 2026-11-07)
    const truck = sc.objects.find(o => o.key.includes('Fire_Truck'));
    if (truck) assert.ok(truck.fp!.x1 <= main!.rect.x0 || truck.fp!.x0 >= main!.rect.x1, `${at}: fire engine clear of the station front`);
  }
});

test('exp-08: 普通街区 (no district) has no landmark', () => {
  const sc = generate('1');
  assert.equal(sc.params.district, undefined);
  assert.ok(!sc.buildings!.some(b => b.front === 'landmark'));
});
