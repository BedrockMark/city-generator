import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { generate } from '../generate';
import { alignScene, alignRef } from './align';
import type { RefWorldJSON } from '../rational/world';

const sc = generate('2', { experiments: false });

test('alignScene maps lawn overlay and building cells', () => {
  const w = alignScene(sc);
  assert.equal(w.cols, sc.cols); assert.equal(w.rows, sc.rows);
  const blds = sc.objects.filter(o => o.cls === 'building');
  const under = (x: number, y: number) => blds.some(o => x * 16 + 15 >= o.x && x * 16 < o.x + o.w && y * 16 + 15 >= o.y && y * 16 < o.y + o.h);
  let lawn = 0;
  sc.ground[1].forEach((row, y) => row.forEach((t, x) => { if (t && t[0] === 'terr' && t[1] === 1 && t[2] === 12 && !under(x, y)) { lawn++; assert.equal(w.ground[y][x], 'grass', `${x},${y}`); } }));
  assert.ok(lawn > 0, 'seed 2 has a visible lawn');
  const b = sc.objects.find(o => o.cls === 'building')!;
  assert.equal(w.ground[Math.floor(b.y / 16)][Math.floor(b.x / 16)], 'wall');
  assert.ok(w.objs.length > 0);
  assert.ok(w.objs.every(o => o.cls !== 'person' && o.cls !== 'building'));
  assert.ok(!w.ground.flat().includes('none'));
});

const REF = '../work/refworld/market_on_street.json';
test('alignRef puts objects into the right cells', { skip: !existsSync(REF) }, () => {
  const j = JSON.parse(readFileSync(REF, 'utf8')) as RefWorldJSON;
  const w = alignRef(j);
  assert.equal(w.rows, j.ground.length); assert.equal(w.cols, j.ground[0].length);
  assert.equal(w.ox, j.phase[0] + j.origin[0] * 16); assert.equal(w.oy, j.phase[1] + j.origin[1] * 16);
  assert.equal(w.objs.length, j.objects.filter(o => o.conf === 'high' && o.cls !== 'building').length);
  for (const o of w.objs.filter(o => o.fy <= j.size[1] && o.fx <= j.size[0])) {
    const c = Math.floor((o.fx - w.ox) / 16), r = Math.floor((o.fy - 1 - w.oy) / 16);
    assert.ok(c >= -1 && c <= w.cols && r >= -1 && r <= w.rows, `${o.key} at ${c},${r}`);
  }
  assert.ok(w.ground.flat().includes('wall'));
});
