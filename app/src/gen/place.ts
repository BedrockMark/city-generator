// Placement helpers: anchoring sprites by their feet, footprint occupancy, keep-clear zones.
// Explanation (stage 4): every placement names its group instance (gid, registered with group()), a reason
// and optionally its own anchor; keep-clear zones and other purposeful areas carry a reason too. None of this
// is read back by the generator, so it cannot change the picture.
import { spr } from './assets';
import { TILE, type Placed, type CellClass, type Anchor, type GroupRec, type ZoneRec, type BuildingRec, type PxRect } from './types';

export interface Rect { x0: number; y0: number; x1: number; y1: number }   // px, half-open
export const rect = (x0: number, y0: number, x1: number, y1: number): Rect => ({ x0, y0, x1, y1 });
export const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

export class SceneBuilder {
  objects: Placed[] = [];
  /** footprints of placed things (what stands on the ground) */
  feet: { r: Rect; cls: string }[] = [];
  /** areas that must stay walkable / visible (door fronts, crossing mouths, alley mouths, bus bay ...) */
  keepClear: { r: Rect; why: string; reason?: string; gid?: string; exp?: string }[] = [];
  private seq = 0;
  groups = new Map<string, GroupRec>();
  private groupN = new Map<string, number>();
  zones: ZoneRec[] = [];
  buildings: BuildingRec[] = [];
  /** experimental feature currently emitting (see withExp) */
  exp?: string;
  constructor(readonly cols: number, readonly rows: number, readonly cls: CellClass[][]) {}

  /** register a group instance; id given -> "type:id", else "type#n". Returns the gid. */
  group(type: string, reason: string, o: { id?: string; anchor?: Anchor } = {}): string {
    let gid: string;
    if (o.id !== undefined) gid = `${type}:${o.id}`;
    else { const n = this.groupN.get(type) ?? 0; this.groupN.set(type, n + 1); gid = `${type}#${n}`; }
    if (!this.groups.has(gid)) this.groups.set(gid, { gid, type, reason, anchor: o.anchor, exp: this.exp, members: [] });
    return gid;
  }
  /** an area with a purpose (yard use, curb run, carriageway ...) */
  zone(layer: ZoneRec['layer'], kind: string, r: PxRect, reason: string, gid?: string) {
    this.zones.push({ id: `z${this.zones.length}`, layer, kind, rect: { ...r }, reason, gid, exp: this.exp });
  }
  /** run fn with everything it emits tagged as produced by experimental feature `id` */
  withExp<T>(id: string, fn: () => T): T {
    const prev = this.exp; this.exp = id;
    try { return fn(); } finally { this.exp = prev; }
  }

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
  putFoot(key: string, fx: number, fy: number, cls: string, o: PutOpts = {}): Placed | null {
    const s = spr(key);
    const x = Math.round(fx - (s.bb[0] + s.bb[2]) / 2), y = Math.round(fy - s.bb[3]);
    return this.putAt(key, x, y, cls, o);
  }

  putAt(key: string, x: number, y: number, cls: string, o: PutOpts & { foot?: number; sub?: number } = {}): Placed | null {
    const s = spr(key);
    const fp = SceneBuilder.footprint(key, x, y, o.depth ?? 10);
    if (!o.force && !this.free(fp, { ignoreClear: o.ignoreClear, pad: o.pad })) return null;
    if (o.walk && !this.onWalk(fp)) return null;
    const p: Placed = { kind: 'sprite', key, file: s.file, x, y, w: s.w, h: s.h, foot: o.foot ?? (y + s.bb[3]), sub: o.sub ?? this.seq++, cls, ...this.explain(o) };
    this.objects.push(p);
    if (o.occupy !== false) this.feet.push({ r: fp, cls });
    return p;
  }

  occupy(r: Rect, cls: string) { this.feet.push({ r, cls }); }
  /** keep-clear zone of kind `why` (what ignoreClear refers to); reason / gid explain it */
  clear(r: Rect, why: string, reason?: string, gid?: string) { this.keepClear.push({ r, why, reason, gid, exp: this.exp }); }

  private explain(o: PutOpts) {
    const g = o.gid ? this.groups.get(o.gid) : undefined;
    if (o.gid && !g) throw new Error(`unregistered group ${o.gid}`);
    return { group: g?.type, gid: o.gid, reason: o.why ?? g?.reason, anchor: o.anchor ?? g?.anchor, ...(this.exp ? { exp: this.exp } : {}) };
  }

  /** character: layers in draw order, frame (col,row) in the 16x32 grid; foot at (fx, fy) */
  putChar(layers: string[], frame: [number, number], fx: number, fy: number, role: string, o: { gid?: string; why?: string; anchor?: Anchor; force?: boolean } = {}): Placed | null {
    fx = Math.round(fx); fy = Math.round(fy);
    const x = fx - 8, y = fy - 30;
    const fp = rect(x + 4, fy - 5, x + 12, fy + 1);
    if (!o.force && !this.free(fp, { ignoreClear: true })) return null;
    const p: Placed = { kind: 'char', key: layers[2] ?? layers[0], file: '', layers, frame, x, y, w: 16, h: 32, foot: fy, sub: this.seq++, cls: 'person:' + role, ...this.explain(o) };
    this.objects.push(p);
    this.feet.push({ r: fp, cls: 'person' });
    return p;
  }

  /** ids, group members and boxes, keep-clear zones into the zone list */
  finish() {
    this.objects.forEach((o, i) => { o.id = `o${i}`; });
    for (const o of this.objects) {
      const g = o.gid ? this.groups.get(o.gid) : undefined;
      if (!g) continue;
      g.members.push(o.id!);
      let b: PxRect;
      if (o.kind === 'sprite') { const s = spr(o.key); b = { x0: o.x + s.bb[0], y0: o.y + s.bb[1], x1: o.x + s.bb[2], y1: o.y + s.bb[3] }; }
      else b = { x0: o.x + 3, y0: o.y + 8, x1: o.x + 13, y1: o.y + 32 };
      g.bbox = g.bbox ? { x0: Math.min(g.bbox.x0, b.x0), y0: Math.min(g.bbox.y0, b.y0), x1: Math.max(g.bbox.x1, b.x1), y1: Math.max(g.bbox.y1, b.y1) } : b;
    }
    const kc: ZoneRec[] = this.keepClear.map((k, i) => ({ id: `k${i}`, layer: 'keepclear', kind: k.why, rect: { ...k.r }, reason: k.reason ?? k.why, gid: k.gid, exp: k.exp }));
    this.zones = [...kc, ...this.zones];
  }
}

export interface PutOpts {
  /** group instance (registered with SceneBuilder.group) */
  gid?: string;
  /** why this item is here (defaults to the group's reason) */
  why?: string;
  /** own anchor (defaults to the group's anchor) */
  anchor?: Anchor;
  force?: boolean; depth?: number; ignoreClear?: boolean | string[]; pad?: number; occupy?: boolean; walk?: boolean;
}
