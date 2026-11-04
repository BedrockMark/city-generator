// exp-01: air-conditioning units on flat roofs (user label 684358 L3: "it can go on a flat roof, not on the ground").
// Only the modular flat roofs (parapet round a flat deck: Roof_1/3/5/7/10); pitched tile roofs never get any.
// Units are drawn right after their building (same depth) so the building's own sprite never covers them.
import type { Rng } from './rng';
import type { BlockPlan } from './block';
import { SceneBuilder, rect, overlaps, type Rect } from './place';
import { spr, hasSprite } from './assets';
import { TILE as T } from './types';

const FLAT_ROOFS = new Set([1, 3, 5, 7, 10].map(v => `5_Floor_Modular_Building/Roof_${v}`));
const AC = ['6_Garage_Sales/Air_Conditioner_Unit_1', '6_Garage_Sales/Air_Conditioner_Unit_2', '6_Garage_Sales/Air_Conditioner_Unit_3',
  '9_Shopping_Center_and_Markets/Air_Conditioner_Unit_3', '9_Shopping_Center_and_Markets/Air_Conditioner_Unit_4'];

export function rooftopAC(plans: BlockPlan[], sb: SceneBuilder, r: Rng) {
  const pool = AC.filter(hasSprite);
  for (const plan of plans) for (const { plan: b, cx, cy } of plan.buildings) {
    const roof = b.parts.find(p => p.role === 'roof');
    if (!roof || !FLAT_ROOFS.has(roof.key)) continue;
    const rr = r.fork(`roof:${b.id}`, { roof: roof.key });
    if (!rr.choose('roof.ac', {}, { p: 0.6 })) continue;
    const x0 = cx * T + roof.dx, y0 = cy * T + roof.dy, rh = spr(roof.key).h;
    // the flat deck inside the parapet
    const deck = rect(x0 + 10, y0 + 20, x0 + b.w * T - 10, y0 + rh - 10);
    const bottom = (cy + b.h) * T;
    const why = `平顶屋顶上的空调外机（${b.id}，${roof.key.split('/').pop()}）：空调外机放在平顶上，不放在地面（标注 684358 L3，实验 exp-01）`;
    const gid = sb.withExp('exp-01', () => sb.group('rooftop', why, { id: b.id, anchor: { kind: 'slot', ref: `${b.id}.roof`, x: (deck.x0 + deck.x1) / 2, y: (deck.y0 + deck.y1) / 2 } }));
    const taken: Rect[] = [];
    const n = rr.count('roof.acCount', {}, 1, 3);
    for (let i = 0, k = 0; i < n * 6 && k < n; i++) {
      const key = rr.choose('roof.acModel', {}, pool), s = spr(key);
      const x = Math.round(deck.x0 - s.bb[0] + rr.range(0, Math.max(0, deck.x1 - deck.x0 - (s.bb[2] - s.bb[0]))));
      const y = Math.round(deck.y0 - s.bb[1] + rr.range(0, Math.max(0, deck.y1 - deck.y0 - (s.bb[3] - s.bb[1]))));
      const box = rect(x + s.bb[0], y + s.bb[1], x + s.bb[2], y + s.bb[3]);
      if (box.x0 < deck.x0 || box.x1 > deck.x1 || box.y0 < deck.y0 || box.y1 > deck.y1 || taken.some(t => overlaps(t, rect(box.x0 - 2, box.y0 - 2, box.x1 + 2, box.y1 + 2)))) continue;
      sb.withExp('exp-01', () => sb.putAt(key, x, y, 'utility', { gid, why: '平顶上的空调外机', force: true, occupy: false, foot: bottom - 0.5, sub: 10 + k }));
      taken.push(box); k++;
    }
  }
}
