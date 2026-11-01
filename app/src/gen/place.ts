// Placement helpers: anchoring sprites by their feet, footprint occupancy, keep-clear zones.
import { spr } from './assets';
import { TILE, type Placed, type CellClass } from './types';

export interface Rect { x0: number; y0: number; x1: number; y1: number }   // px, half-open
export const rect = (x0: number, y0: number, x1: number, y1: number): Rect => ({ x0, y0, x1, y1 });
export const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

export class SceneBuilder {
  objects: Placed[] = [];
  /** footprints of placed things (what stands on the ground) */
  feet: { r: Rect; cls: string }[] = [];
  /** areas that must stay walkable / visible (door fronts, crossing mouths, alley mouths, bus bay ...) */
  keepClear: { r: Rect; why: string }[] = [];
  private seq = 0;
  constructor(readonly cols: number, readonly rows: number, readonly cls: CellClass[][]) {}

  cellAt(px: number, py: number): CellClass | undefined { return this.cls[Math.floor(py / TILE)]?.[Math.floor(px / TILE)]; }
  /** every corner of the rect lies on sidewalk (main or neighbour) */
  onWalk(r: Rect): boolean {
    return [[r.x0, r.y0], [r.x1 - 1, r.y0], [r.x0, r.y1 - 1], [r.x1 - 1, r.y1 - 1]].every(([x, y]) => { const c = this.cellAt(x, y); return c === 'walk' || c === 'nwalk'; });
  }

  /** footprint of a sprite whose image top-left is (x,y): bottom band of its opaque bbox */
  static footprint(key: string, x: number, y: number, depth = 10): Rect {
    const s = spr(key); const [b0, , b2, b3] = s.bb;
    return rect(x + b0, y + b3 - Math.min(depth, s.bb[3] - s.bb[1]), x + b2, y + b3);
  }

  /** ignoreClear: true = ignore every keep-clear zone, or a list of zone kinds ('walkway', 'door' ...) to ignore */
  free(r: Rect, opts: { ignoreClear?: boolean | string[]; pad?: number } = {}): boolean {
    const p = opts.pad ?? 0;
    const rr = rect(r.x0 - p, r.y0 - p, r.x1 + p, r.y1 + p);
    if (rr.x0 < 0 || rr.y0 < 0 || rr.x1 > this.cols * TILE || rr.y1 > this.rows * TILE) return false;
    if (this.feet.some(f => overlaps(f.r, rr))) return false;
    const ig = opts.ignoreClear;
    if (ig !== true && this.keepClear.some(k => overlaps(k.r, r) && !(ig && ig.includes(k.why)))) return false;
    return true;
  }

  /** place sprite with its foot (bottom-centre of opaque bbox) at (fx, fy). Returns null if blocked. */
  putFoot(key: string, fx: number, fy: number, cls: string, o: { group?: string; force?: boolean; depth?: number; ignoreClear?: boolean | string[]; pad?: number; occupy?: boolean; walk?: boolean } = {}): Placed | null {
    const s = spr(key);
    const x = Math.round(fx - (s.bb[0] + s.bb[2]) / 2), y = Math.round(fy - s.bb[3]);
    return this.putAt(key, x, y, cls, o);
  }

  putAt(key: string, x: number, y: number, cls: string, o: { group?: string; force?: boolean; depth?: number; ignoreClear?: boolean | string[]; pad?: number; occupy?: boolean; foot?: number; sub?: number; walk?: boolean } = {}): Placed | null {
    const s = spr(key);
    const fp = SceneBuilder.footprint(key, x, y, o.depth ?? 10);
    if (!o.force && !this.free(fp, { ignoreClear: o.ignoreClear, pad: o.pad })) return null;
    if (o.walk && !this.onWalk(fp)) return null;
    const p: Placed = { kind: 'sprite', key, file: s.file, x, y, w: s.w, h: s.h, foot: o.foot ?? (y + s.bb[3]), sub: o.sub ?? this.seq++, cls, group: o.group };
    this.objects.push(p);
    if (o.occupy !== false) this.feet.push({ r: fp, cls });
    return p;
  }

  occupy(r: Rect, cls: string) { this.feet.push({ r, cls }); }
  clear(r: Rect, why: string) { this.keepClear.push({ r, why }); }

  /** character: layers in draw order, frame (col,row) in the 16x32 grid; foot at (fx, fy) */
  putChar(layers: string[], frame: [number, number], fx: number, fy: number, role: string, o: { group?: string; force?: boolean } = {}): Placed | null {
    fx = Math.round(fx); fy = Math.round(fy);
    const x = fx - 8, y = fy - 30;
    const fp = rect(x + 4, fy - 5, x + 12, fy + 1);
    if (!o.force && !this.free(fp, { ignoreClear: true })) return null;
    const p: Placed = { kind: 'char', key: layers[2] ?? layers[0], file: '', layers, frame, x, y, w: 16, h: 32, foot: fy, sub: this.seq++, cls: 'person:' + role, group: o.group };
    this.objects.push(p);
    this.feet.push({ r: fp, cls: 'person' });
    return p;
  }
}
