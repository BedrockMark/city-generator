// Pixel boxes of placed objects: what the annotation overlay outlines and the label tools attribute to.
import { spr, hasSprite } from './assets';
import type { Placed, PxRect, Scene } from './types';

export function objBox(o: Placed): PxRect {
  if (o.kind === 'sprite' && hasSprite(o.key)) { const b = spr(o.key).bb; return { x0: o.x + b[0], y0: o.y + b[1], x1: o.x + b[2], y1: o.y + b[3] }; }
  if (o.kind === 'char') return { x0: o.x + 3, y0: o.y + 8, x1: o.x + 13, y1: o.y + 32 };
  return { x0: o.x, y0: o.y, x1: o.x + o.w, y1: o.y + o.h };
}

/** objects standing behind a building, inside its sprite (drawn over by it) */
export function hiddenObjects(sc: Scene): Set<string> {
  const out = new Set<string>();
  for (const o of sc.objects) {
    if (o.cls === 'building') continue;
    const b = objBox(o);
    if ((sc.buildings ?? []).some(bd => o.foot < bd.solid.y0 && b.x0 >= bd.rect.x0 && b.x1 <= bd.rect.x1 && b.y0 >= bd.rect.y0)) out.add(o.id!);
  }
  return out;
}
