// Task 3 (v0.8.3): the green island's content. Lives under world/ because it needs the world's island blocks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundabout, type Roundabout } from './roundabout';
import { generateBlock } from './window';
import { TILE } from '../gen/types';

const R = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => a + k);
const lotSize = (rb: Roundabout) => [rb.island.x1 - rb.island.x0, rb.island.y1 - rb.island.y0];

function find(w: number, h: number): [string, Roundabout][] {
  const out: [string, Roundabout][] = [];
  for (let n = 1; n <= 200 && out.length < 4; n++) for (const i of R(-2, 2)) for (const j of R(-2, 2)) {
    const rb = roundabout(String(n), i, j);
    if (rb && rb.wv === w && rb.wh === h && out.length < 4) out.push([String(n), rb]);
  }
  return out;
}

for (const [label, w, h] of [['11x11', 11, 11], ['17x11', 17, 11]] as const) {
  test(`roundabout island content ${label}`, () => {
    const cases = find(w, h);
    assert.ok(cases.length > 0, `no ${label} roundabout found`);
    for (const [s, rb] of cases) {
      const bs = generateBlock(s, `r${rb.i},${rb.j}`), sc = bs.scene, ox = bs.ox, oy = bs.oy;
      const tag = `${s} r${rb.i},${rb.j}`;
      const [lw, lh] = lotSize(rb).map(v => v - 4);  // the lot is the island inside its 2-cell sidewalk
      assert.equal((sc.buildings ?? []).length, 0, tag);
      for (const o of sc.objects) {
        assert.ok(!/Bench|Kiosk|Pavilion/.test(o.key), `${tag}: ${o.key}`);
        assert.notEqual(o.kind, 'char', `${tag}: a person`);
      }
      assert.equal(sc.objects.filter(o => o.kind === 'char').length, 0, tag);
      const gids = new Set(sc.objects.filter(o => o.gid !== undefined).map(o => o.gid));
      assert.equal(sc.objects.filter(o => o.gid === undefined).length, 0, `${tag}: object outside the group`);
      assert.equal(gids.size, 1, tag);
      assert.ok([...gids][0]!.startsWith('roundabout'), tag);
      assert.ok((sc.groups ?? []).every(g => g.type === 'roundabout'), `${tag}: ${(sc.groups ?? []).map(g => g.type)}`);
      // exactly one centre piece, near the lot's centre
      const centre = sc.objects.filter(o => /Fountain|Statue|Tree_11|Tree_13/.test(o.key));
      assert.equal(centre.length, 1, `${tag}: ${centre.map(o => o.key)}`);
      const lcx = (rb.island.x0 + rb.island.x1) / 2 - ox, lcy = (rb.island.y0 + rb.island.y1) / 2 - oy;
      const fx = centre[0].x + centre[0].w / 2, fy = centre[0].foot;
      assert.ok(Math.abs(fx / TILE - lcx) <= 2 && Math.abs(fy / TILE - lcy) <= 2, `${tag}: piece at ${fx / TILE},${fy / TILE} vs ${lcx},${lcy}`);
      // lawn under the lot
      for (let y = rb.island.y0 + 2; y < rb.island.y1 - 2; y++) for (let x = rb.island.x0 + 2; x < rb.island.x1 - 2; x++) {
        const o = sc.ground[1][y - oy][x - ox];
        assert.ok(o && o[0] === 'terr' && o[2] >= 11 && o[2] <= 13 && o[1] <= 2, `${tag}: no lawn at ${x},${y}`);
      }
      const z = (sc.zones ?? []).filter(q => q.kind === 'roundabout');
      assert.equal(z.length, 1, tag);
      assert.ok(z[0].reason.includes('环岛'), tag);
      assert.ok(lw > 0 && lh > 0);
    }
  });
}
