// Picture difference of two scenes (stage 7 A/B): what a viewer would see change.
// Objects: multiset difference of the signature tuples WITHOUT `sub` (a placement sequence number: one added object
// shifts it for every later one, so with it the whole picture would count as changed). Extras on either side count;
// id = tuple JSON + '#<copy>', box = the sprite rect. Ground: per layer, per cell; id = 'g:<layer>:<x>:<y>'.
import { TILE, type Placed, type PxRect, type Scene } from '../types';

export interface DiffItem { id: string; rect: PxRect }

const tuple = (o: Placed) => JSON.stringify([o.kind, o.file, o.key, o.x, o.y, o.foot, o.solid ?? null, o.layers ?? null, o.frame ?? null]);

export function diffItems(a: Scene, b: Scene): DiffItem[] {
  const out: DiffItem[] = [];
  const count = (sc: Scene) => {
    const m = new Map<string, { n: number; o: Placed }>();
    for (const o of sc.objects) { const k = tuple(o), e = m.get(k); if (e) e.n++; else m.set(k, { n: 1, o }); }
    return m;
  };
  const ca = count(a), cb = count(b);
  for (const [m1, m2] of [[ca, cb], [cb, ca]]) for (const [k, { n, o }] of m1) {
    const lo = m2.get(k)?.n ?? 0;
    for (let j = lo; j < n; j++) out.push({ id: `${k}#${j}`, rect: { x0: o.x, y0: o.y, x1: o.x + o.w, y1: o.y + o.h } });
  }
  const L = Math.max(a.ground.length, b.ground.length);
  for (let l = 0; l < L; l++) {
    const ga = a.ground[l] ?? [], gb = b.ground[l] ?? [], R = Math.max(ga.length, gb.length);
    for (let y = 0; y < R; y++) {
      const ra = ga[y] ?? [], rb = gb[y] ?? [], C = Math.max(ra.length, rb.length);
      for (let x = 0; x < C; x++) if (JSON.stringify(ra[x] ?? null) !== JSON.stringify(rb[x] ?? null))
        out.push({ id: `g:${l}:${x}:${y}`, rect: { x0: x * TILE, y0: y * TILE, x1: (x + 1) * TILE, y1: (y + 1) * TILE } });
    }
  }
  return out;
}

export const pad = (r: PxRect, p = 8): PxRect => ({ x0: r.x0 - p, y0: r.y0 - p, x1: r.x1 + p, y1: r.y1 + p });
export const bbox = (rs: PxRect[]): PxRect | null => rs.length ? {
  x0: Math.min(...rs.map(r => r.x0)), y0: Math.min(...rs.map(r => r.y0)), x1: Math.max(...rs.map(r => r.x1)), y1: Math.max(...rs.map(r => r.y1)),
} : null;
/** distance between two boxes (euclidean between their nearest edges), 0 when they overlap or touch */
export const gap = (a: PxRect, b: PxRect): number => Math.hypot(Math.max(0, a.x0 - b.x1, b.x0 - a.x1), Math.max(0, a.y0 - b.y1, b.y0 - a.y1));
/** do two boxes share some area */
export const overlaps = (a: PxRect, b: PxRect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
