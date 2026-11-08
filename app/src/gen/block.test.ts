import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from './generate';

test('the plaza stays on the block (425033 L1: it was paved over the road; 47: over the sidewalk)', () => {
  for (const seed of ['425033', '47']) {
    const sc = generate(seed);
    const plazas = sc.zones!.filter(z => z.layer === 'block' && z.kind === 'plaza');
    assert.ok(plazas.length > 0, `seed ${seed} still has its plaza (shifted back inside)`);
    for (const z of plazas) for (let y = z.rect.y0 / 16; y < z.rect.y1 / 16; y++) for (let x = z.rect.x0 / 16; x < z.rect.x1 / 16; x++)
      assert.equal(sc.cells[y][x], 'lot', `seed ${seed}: plaza cell ${x},${y}`);
  }
});
