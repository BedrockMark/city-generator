import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from './generate';
import { DISTRICT_KINDS, type DistrictKind } from './district';
import { overlaps } from './place';

/** what each district must have besides its landmark (user 2026-11-07) */
const MUST: Record<DistrictKind, (keys: string[]) => boolean> = {
  school: k => k.some(x => /Basketball_Court|Soccer_Court/.test(x)),
  hospital: k => k.some(x => x.includes('Helicopter_Landing_Pad')),
  police: k => k.filter(x => /Police_Car_[34]|Car_Down/.test(x)).length >= 3 && k.some(x => x.includes('Automatic_Barrier')),
  fire: k => k.some(x => x.includes('Fire_Truck')),
  mall: k => k.some(x => x.includes('Underground_Parking')) && k.some(x => x.includes('Billboard')),
  hotel: k => k.some(x => x.includes('Underground_Parking')),
  gas: k => k.some(x => /Gas_Station_[12]$/.test(x)) && k.some(x => x.includes('Price_Signboard')),
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
    // the campus: the landmark's sprites, the campus groups and its roof units (untagged since exp-08 was adopted, 0.7.8)
    const keys = sc.objects.filter(o => o.gid === main!.gid || /^landmark|^rooftop/.test(o.gid ?? '')).map(o => o.key);
    assert.ok(MUST[d](keys), `${at}: campus features (${[...new Set(keys.map(k => k.split('/')[1]))].join(', ')})`);
    assert.ok(!sc.objects.some(o => o.exp === 'exp-08'), `${at}: nothing tagged exp-08 (adopted)`);
    // the fire engine waits beside the station, not in front of its garages and door (user 2026-11-07)
    const truck = sc.objects.find(o => o.key.includes('Fire_Truck'));
    if (truck) assert.ok(truck.fp!.x1 <= main!.rect.x0 || truck.fp!.x0 >= main!.rect.x1, `${at}: fire engine clear of the station front`);
    // v0.7.8: the police booth never stands on a bay (bays are the 2_City_Terrains bay pieces)
    const booth = sc.objects.find(o => o.key.includes('Parking_Booth'));
    if (booth) for (const car of sc.objects.filter(o => o.cls === 'vehicle' && o.fp)) assert.ok(!overlaps(booth.fp!, car.fp!), `${at}: booth clear of ${car.key}`);
  }
});

test('v0.7.8: courts have hoops / goals, the gas station has its driveways', () => {
  let booths = 0, playgrounds = 0;
  for (const seed of ['1', '2', '3', '4', '5', '6', '7', '8']) {
    const school = generate(seed, { district: 'school' });
    const court = school.objects.find(o => /Basketball_Court|Soccer_Court/.test(o.key))!;
    assert.ok(school.objects.some(o => /Basketball_Net|Soccer_Net/.test(o.key)) || /Court_[5-8]$|Soccer_Court_2$/.test(court.key), `school ${seed}: ${court.key} has hoops / goals`);
    if (school.zones!.some(z => z.kind === 'playground')) playgrounds++;
    if (generate(seed, { district: 'police' }).objects.some(o => o.key.includes('Parking_Booth'))) booths++;
    const gas = generate(seed, { district: 'gas' });
    assert.equal(gas.zones!.filter(z => z.kind === 'driveway' && /^landmark/.test(z.gid ?? '')).length, 2, `gas ${seed}: entry and exit driveways`);
  }
  assert.ok(booths >= 3, `police booths ${booths}/8`);
  assert.ok(playgrounds >= 1, `school playgrounds ${playgrounds}/8`);
});

test('exp-08 adopted: 普通街区 is now and then a special district, otherwise no landmark', () => {
  let mixed = 0;
  for (let i = 1; i <= 60; i++) {
    const sc = generate(String(i));
    if (sc.params.district) { mixed++; assert.ok(sc.buildings!.some(b => b.front === 'landmark'), `seed ${i}: ${sc.params.district} has its landmark`); }
    else assert.ok(!sc.buildings!.some(b => b.front === 'landmark'), `seed ${i}: no landmark`);
  }
  assert.ok(mixed >= 4 && mixed <= 24, `special districts ${mixed}/60 (chance 0.2)`);
});
