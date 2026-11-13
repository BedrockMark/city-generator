// C26 block reachability (v0.8.3, spec 3, report only): can a walker leave this block over a zebra crossing?
// A block passes when one of its sidewalk cells is the landing of a crossing (the cell just beside either end of the
// zebra, across the road direction). Objects in the way are not looked at (the block's own constraints cover them).
import { blockById, lotOf } from './blocks';
import { crossingsIn } from './cells';
import { CROSSING_LEN } from './config';
import type { Rect } from './types';

export interface Reach { ok: boolean; exempt?: string; crossings: number; why: string }

const memo = new Map<string, Reach>();
const MEMO_MAX = 4096;

/** Slack around the block's bounding rect: a landing cell is one cell beyond the zebra, so 1 is enough; 2 is safe. */
const REACH_PAD = 2;

export function blockReach(seed: string, blockId: string): Reach {
  const key = `${seed}|${blockId}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const b = blockById(seed, blockId);
  let out: Reach;
  if (b.shape === 'roundabout') {
    const why = 'C26：豁免——环岛中心岛不让人进，不要求横道通到这里';
    out = { ok: true, exempt: '环岛中心岛不让人进', crossings: 0, why };
  } else {
    const bb: Rect = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const f of b.foot) {
      bb.x0 = Math.min(bb.x0, f.x0); bb.y0 = Math.min(bb.y0, f.y0);
      bb.x1 = Math.max(bb.x1, f.x1); bb.y1 = Math.max(bb.y1, f.y1);
    }
    const r = { x0: bb.x0 - REACH_PAD, y0: bb.y0 - REACH_PAD, x1: bb.x1 + REACH_PAD, y1: bb.y1 + REACH_PAD };
    const mine = (x: number, y: number) =>
      b.foot.some(f => x >= f.x0 && x < f.x1 && y >= f.y0 && y < f.y1)
      && !b.cut?.some(q => x >= q.x0 && x < q.x1 && y >= q.y0 && y < q.y1)
      && !lotOf(b, x, y);
    let n = 0;
    for (const c of crossingsIn(seed, r)) {
      let lands = false;
      for (let p = c.at; p < c.at + CROSSING_LEN && !lands; p++) {
        for (const k of [c.band0 - 1, c.band1]) {
          if (c.axis === 'h' ? mine(p, k) : mine(k, p)) { lands = true; break; }
        }
      }
      if (lands) n++;
    }
    out = { ok: n > 0, crossings: n, why: n > 0 ? `可达（C26）：经 ${n} 条横道` : 'C26：没有横道通到这个街区' };
  }
  if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value!);
  memo.set(key, out);
  return out;
}
