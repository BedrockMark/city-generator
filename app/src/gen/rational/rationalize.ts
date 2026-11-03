// Stage 5: rationalising post-process. The generator proposes; the constraints judge; this repairs by deleting
// (宁删勿补): offending objects are removed, dead zones fall back to plain filling (lawn or bare ground), and the
// removal cascades through anchors (a chair whose table went goes too). Consumes no random numbers, so whatever
// it does not touch stays exactly as generated.
//
// Always writes scene.audit (violations of every non-off constraint, what was pruned and why, graph summary).
// Repairs only with constraints whose status is 'active' (confirmed by the user), plus the drafts when
// options.pruneDraft is set (preview).
import { CONSTRAINTS, evaluate, makeCtx, union, type Constraint, type Violation } from './constraints';
import { worldFromScene, isGrassTile } from './world';
import { rooted } from './graph';
import type { Scene, PxRect, TileRef } from '../types';
import { TILE as T } from '../types';

export interface Pruned { id: string; key: string; cls: string; gid?: string; x: number; y: number; w: number; h: number; c: string; msg: string }
export interface Audit {
  /** constraint id -> remaining violations after repair */
  counts: Record<string, number>;
  /** constraint id -> violations found before any repair */
  before: Record<string, number>;
  violations: Violation[];
  pruned: Pruned[];
  downgraded: { zone: string; kind: string; c: string; style: string; rect: PxRect; msg: string }[];
  /** ground repairs: lawn lifted to show the paving (unlawn), path laid on (pave), path turned into lawn */
  regrounded: { c: string; rect: PxRect; what: 'unlawn' | 'pave' | 'lawn'; msg: string }[];
  /** constraints that repaired in this run */
  applied: string[];
  graph: { comps: number; rooted: number; places: number; links: number; doors: number; doorsBlocked: number; doorsCutOff: number };
  /** groups that decided to place something but ended up with no member */
  emptyGroups: string[];
}

export function rationalize(sc: Scene, o: { prune: boolean; pruneDraft: boolean }): Audit {
  const live = CONSTRAINTS.filter(c => c.status !== 'off');
  const repairing = live.filter(c => c.fix !== 'report' && (c.status === 'active' ? o.prune : c.status === 'draft' && o.pruneDraft));
  const pruned: Pruned[] = [];
  const downgraded: Audit['downgraded'] = [];
  const before: Record<string, number> = {};
  const regrounded: Audit['regrounded'] = [];
  const groundDone = new Set<string>();
  let first = true;
  for (let iter = 0; iter < 40; iter++) {
    const cx = makeCtx(worldFromScene(sc));
    if (first) { for (const c of live) before[c.id] = evaluate(c, cx).length; first = false; }
    if (!repairing.length) break;
    // one constraint at a time (list order), re-judged after every change, so repairs never act on a stale map
    const remove = new Map<string, Violation>();
    let reground = false;
    const c = repairing.find(k => evaluate(k, cx).some(v => v.objs.length || (v.zone && !downgraded.some(d => d.zone === v.zone)) || ((v.clearLawn?.length || v.toLawn?.length || v.pave?.length || v.dropZones?.length) && !groundDone.has(`${v.c}:${v.target}`))));
    if (!c) break;
    for (const v of evaluate(c, cx)) {
      // ground repairs (once per violation target): uncover paving, lay a path on, turn a needless path into lawn
      const key = `${v.c}:${v.target}`;
      if ((v.clearLawn?.length || v.toLawn?.length || v.pave?.length || v.dropZones?.length) && !groundDone.has(key)) {
        groundDone.add(key); reground = true;
        for (const pv of v.pave ?? []) sc.ground[0][pv.cell[1]][pv.cell[0]] = sc.ground[0][pv.src[1]][pv.src[0]];
        if (v.clearLawn?.length) unlawn(sc, v.clearLawn);
        for (const r of v.toLawn ?? []) lawn(sc, r);
        if (v.dropZones?.length) sc.zones = sc.zones!.filter(z => !v.dropZones!.includes(z.id));
        const rs = [...(v.toLawn ?? []), ...(v.clearLawn ?? [])];
        if (rs.length) regrounded.push({ c: v.c, rect: union(rs), what: v.toLawn?.length ? 'lawn' : v.pave?.length ? 'pave' : 'unlawn', msg: v.msg });
      }
      if (c.fix === 'downgrade' && v.zone && !downgraded.some(d => d.zone === v.zone)) {
        const z = sc.zones!.find(z => z.id === v.zone)!;
        downgraded.push({ zone: z.id, kind: z.kind, c: c.id, style: c.downgrade ?? 'clear', rect: z.rect, msg: v.msg }); reground = true;
        z.reason += `（阶段 5 降级：${c.id} ${c.title} → ${c.downgrade === 'lawn' ? '草坪' : '只留植物'}）`;
        if (c.downgrade === 'lawn') lawn(sc, z.rect);
        // the zone's own keep-clear areas lose their reason with it
        if (c.downgrade === 'lawn') sc.zones = sc.zones!.filter(k => !(k.layer === 'keepclear' && k.gid === z.gid && z.gid));
      }
      for (const id of v.objs) if (!remove.has(id)) remove.set(id, v);
    }
    if (!remove.size && !reground) break;
    const keep = sc.objects.filter(p => !remove.has(p.id!));
    for (const p of sc.objects) {
      const v = remove.get(p.id!); if (!v) continue;
      pruned.push({ id: p.id!, key: p.key, cls: p.cls, gid: p.gid, x: p.x, y: p.y, w: p.w, h: p.h, c: v.c, msg: v.msg });
    }
    sc.objects = keep;
  }
  // group membership after pruning
  if (pruned.length) {
    const gone = new Set(pruned.map(p => p.id));
    for (const g of sc.groups ?? []) g.members = g.members.filter(m => !gone.has(m));
  }
  const cx = makeCtx(worldFromScene(sc));
  // a downgraded zone has been dealt with (it is no longer a passage / a used space)
  const done = new Set(downgraded.map(d => d.zone));
  const violations = live.flatMap(c => evaluate(c, cx)).filter(v => !(v.zone && done.has(v.zone)));
  const counts: Record<string, number> = {};
  for (const c of live) counts[c.id] = violations.filter(v => v.c === c.id).length;
  const g = cx.g;
  return {
    counts, before, violations, pruned, downgraded, regrounded, applied: repairing.map(c => c.id),
    graph: { comps: g.compRoots.length, rooted: g.compRoots.filter((_, i) => rooted(g, i)).length, places: g.places.length, links: g.links.size,
      doors: g.doors.length, doorsBlocked: g.doors.filter(d => d.comp < 0).length, doorsCutOff: g.doors.filter(d => d.comp >= 0 && !g.compRoots[d.comp].has('street') && !g.compRoots[d.comp].has('edge')).length },
    emptyGroups: (sc.groups ?? []).filter(gr => !gr.members.length).map(gr => gr.gid),
  };
}

/** remove the lawn overlay from the cells of the rects (the paving under it shows) and re-slice the lawn around */
function unlawn(sc: Scene, rs: PxRect[]) {
  const over = sc.ground[1];
  const mask = over.map(row => row.map(isGrass));
  for (const r of rs) for (let y = Math.floor(r.y0 / T); y < Math.ceil(r.y1 / T); y++) for (let x = Math.floor(r.x0 / T); x < Math.ceil(r.x1 / T); x++)
    if (mask[y]?.[x]) { mask[y][x] = false; over[y][x] = null; }
  slice(sc, mask);
}
function slice(sc: Scene, mask: boolean[][]) {
  const over = sc.ground[1];
  const g = (x: number, y: number) => mask[y]?.[x] === true;
  for (let y = 0; y < sc.rows; y++) for (let x = 0; x < sc.cols; x++) {
    if (!g(x, y)) continue;
    const l = g(x - 1, y), rr = g(x + 1, y), u = g(x, y - 1), d = g(x, y + 1);
    over[y][x] = ['terr', !l && rr ? 0 : l && !rr ? 2 : 1, !u && d ? 11 : u && !d ? 13 : 12];
  }
}

// lawn on the visible cells of a rect, merged with the lawns already there (same 9-slice as yard.ts paintGrass)
const isGrass = isGrassTile;
function lawn(sc: Scene, r: PxRect) {
  const over = sc.ground[1];
  const behind = (sc.buildings ?? []).map(b => ({ ...b.rect, y1: b.solid.y0 }));
  const mask = over.map(row => row.map(isGrass));
  for (let y = Math.floor(r.y0 / T); y < Math.ceil(r.y1 / T); y++) for (let x = Math.floor(r.x0 / T); x < Math.ceil(r.x1 / T); x++) {
    if (!over[y] || x < 0 || x >= sc.cols) continue;
    const cx = x * T + 8, cy = y * T + 8;
    if (behind.some(b => cx >= b.x0 && cx < b.x1 && cy >= b.y0 && cy < b.y1)) continue;
    if (over[y][x] && !isGrass(over[y][x])) continue;   // keep other overlay pieces
    mask[y][x] = true;
  }
  slice(sc, mask);
}

export type { Constraint };
