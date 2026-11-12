import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planCentre, CENTRE_INSET } from './centre';
import { Rng } from './rng';

const LOT = { bx0: 0, by0: 0, bx1: 50, by1: 36 };

test('planCentre insets the lot 14 south, 10 north / east / west', () => {
  const res = planCentre(LOT, 'plaza', new Rng('t'));
  assert.ok('area' in res, 'an area');
  const { area } = res;
  assert.equal(area.kind, 'plaza');
  assert.deepEqual([area.x0, area.y0, area.x1, area.y1], [10, 10, 40, 22]);
  assert.deepEqual([area.x0, area.y0, LOT.bx1 - area.x1, LOT.by1 - area.y1], [CENTRE_INSET.w, CENTRE_INSET.n, CENTRE_INSET.e, CENTRE_INSET.s]);
  assert.ok(area.why.includes('中心广场') && area.why.includes('30×12'), area.why);
});

test('planCentre: a south passage and one from the east, west or north, 2-3 wide, into the area', () => {
  const sides = new Set<string>();
  for (let i = 0; i < 40; i++) {
    const res = planCentre(LOT, i % 2 ? 'plaza' : 'garden', new Rng(`t${i}`));
    assert.ok('area' in res, `t${i}: an area`);
    const { area, passages } = res;
    assert.equal(passages.length, 2, `t${i}`);
    for (const p of passages) {
      assert.equal(p.kind, 'alley');
      assert.equal(p.toCentre, true);
      assert.ok(p.why.includes('通往中心'), p.why);
    }
    const [s, q] = passages;
    assert.ok(s.x1 - s.x0 >= 2 && s.x1 - s.x0 <= 3, `t${i} south width`);
    assert.ok(s.x0 >= area.x0 && s.x1 <= area.x1, `t${i} south columns within the area`);
    assert.equal(s.y0, area.y1);
    assert.equal(s.y1, LOT.by1);
    if (q.x0 === area.x1 && q.x1 === LOT.bx1) sides.add('E');
    else if (q.x0 === LOT.bx0 && q.x1 === area.x0) sides.add('W');
    else if (q.y0 === LOT.by0 && q.y1 === area.y0) sides.add('N');
    else assert.fail(`t${i}: second passage ${JSON.stringify(q)} reaches no side`);
    if (q.y0 === LOT.by0) {
      assert.ok(q.x1 - q.x0 >= 2 && q.x1 - q.x0 <= 3, `t${i} north width`);
      assert.ok(q.x0 >= area.x0 && q.x1 <= area.x1, `t${i} north columns within the area`);
    } else {
      assert.ok(q.y1 - q.y0 >= 2 && q.y1 - q.y0 <= 3, `t${i} side width`);
      assert.ok(q.y0 >= area.y0 && q.y1 <= area.y1, `t${i} side rows within the area`);
    }
  }
  assert.deepEqual([...sides].sort(), ['E', 'N', 'W']);
});

test('planCentre: too small a lot gives a note, no area', () => {
  const res = planCentre({ bx0: 0, by0: 0, bx1: 40, by1: 30 }, 'garden', new Rng('t'));
  assert.ok('note' in res && res.note.includes('不足 12×8'), JSON.stringify(res));
});
