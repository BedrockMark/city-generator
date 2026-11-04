// Annotation overlay (key A), drawn with Canvas 2D so the same code paints the screen overlay and the
// exported _annotated.png. World px -> canvas px: (p - o) * s.
import { spr, hasSprite } from '../gen/assets';
import type { Scene, Placed, PxRect, ZoneRec, GroupRec, BuildingRec } from '../gen/types';
import type { Label } from './labels';
import { objBox, hiddenObjects } from '../gen/judge/align';
export { objBox, hiddenObjects };

export interface View { s: number; ox: number; oy: number }

export type Sel =
  | { kind: 'object'; id: string }
  | { kind: 'region'; rect: PxRect }
  | { kind: 'point'; x: number; y: number };

export interface OverlayState {
  layers: { groups: boolean; zones: boolean; buildings: boolean; labels: boolean; audit: boolean };
  hiddenTypes: Set<string>;
  hiddenZones: Set<string>;
  ghost: boolean;
  hover?: Sel;
  pinned?: Sel;
  /** rubber band while shift-dragging */
  box?: PxRect;
  labels: Label[];
}

export const EXP_COLOR = '#ff2bd6';
export const NOVEL_COLOR = '#00e5ff';
const GOOD = '#36d36b', BAD = '#ff4040';
const AUDIT_BAD = '#e53935', AUDIT_DOWN = '#8e24aa';
const grow = (r: PxRect, d: number): PxRect => ({ x0: r.x0 - d, y0: r.y0 - d, x1: r.x1 + d, y1: r.y1 + d });

const TYPE_COLORS: Record<string, string> = {
  bld: '#b0b0b0', front: '#ff9800', forecourt: '#ffb74d', bus: '#2196f3', crossing: '#f5f5f5',
  'curb-lamps': '#ffeb3b', 'curb-trees': '#43a047', 'curb-planters': '#9ccc65', 'curb-bollards': '#a1887f', 'curb-bin': '#90a4ae', 'curb-hydrant': '#f44336',
  parked: '#5c6bc0', traffic: '#9575cd', manhole: '#757575', works: '#ff5722', walkers: '#26c6da',
  alley: '#bcaaa4', plaza: '#e91e63', island: '#f06292', pocket: '#ce93d8',
  parking: '#7986cb', garden: '#66bb6a', passage: '#d7ccc8', strip: '#aed581', service: '#8d6e63', backyard: '#78909c', paved: '#9e9e9e',
};
const ZONE_COLORS: Record<string, string> = {
  door: '#ff9800', walkway: '#00e5ff', crossing: '#ffffff', alley: '#d7ccc8', 'bus stop': '#2196f3', drive: '#ffeb3b', aisle: '#fff59d', path: '#c5e1a5', passage: '#bcaaa4',
  carriageway: '#37474f', zebra: '#eceff1', driveway: '#ffeb3b',
  'curb:trees': '#43a047', 'curb:planters': '#9ccc65', 'curb:bollards': '#a1887f', 'curb:none': '#616161', 'curb:short': '#424242',
};
const hashHue = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; };
export const typeColor = (t: string) => TYPE_COLORS[t] ?? `hsl(${hashHue(t)} 70% 60%)`;
export const zoneColor = (z: Pick<ZoneRec, 'kind' | 'layer'>) => ZONE_COLORS[z.kind] ?? TYPE_COLORS[z.kind] ?? `hsl(${hashHue(z.kind)} 50% 55%)`;
/** filter key of a zone in the legend */
export const zoneKey = (z: ZoneRec) => `${z.layer}/${z.kind}`;

export const ZONE_LAYER_NAMES: Record<ZoneRec['layer'], string> = { keepclear: '禁放 / 保持畅通', yard: '内院分配', curb: '路缘段', road: '马路', block: '街区开口' };

/** opaque box of an object (px) */
const inR = (r: PxRect, x: number, y: number) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;
export const intersects = (a: PxRect, b: PxRect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** objects completely hidden behind a building's upper part (backyard life): only pickable in ghost view */
/** front-most non-building object under the point, else the building, else null */
export function pick(sc: Scene, x: number, y: number, ghost: boolean, hidden: Set<string>): Placed | null {
  let best: Placed | null = null;
  for (const o of sc.objects) {
    if (o.cls === 'building' || (!ghost && hidden.has(o.id!))) continue;
    if (!inR(objBox(o), x, y)) continue;
    if (!best || o.foot > best.foot || (o.foot === best.foot && (o.sub ?? 0) > (best.sub ?? 0))) best = o;
  }
  if (best) return best;
  const bd = (sc.buildings ?? []).filter(b => inR(b.rect, x, y)).sort((a, b) => b.rect.y1 - a.rect.y1)[0];
  if (bd) return sc.objects.find(o => o.gid === bd.gid) ?? null;
  return null;
}

/** why is this point empty: zones covering it, most specific first */
export function zonesAt(sc: Scene, x: number, y: number): ZoneRec[] {
  const order: Record<ZoneRec['layer'], number> = { keepclear: 0, block: 1, yard: 2, curb: 3, road: 4 };
  return (sc.zones ?? []).filter(z => inR(z.rect, x, y)).sort((a, b) => order[a.layer] - order[b.layer]);
}

export function buildingOf(sc: Scene, o: Placed): BuildingRec | undefined {
  return o.cls === 'building' ? sc.buildings?.find(b => b.gid === o.gid) : undefined;
}

// ------------------------------------------------------------------------------------------------

export function drawOverlay(ctx: CanvasRenderingContext2D, sc: Scene, v: View, st: OverlayState) {
  const X = (x: number) => (x - v.ox) * v.s, Y = (y: number) => (y - v.oy) * v.s;
  const R = (r: PxRect) => [X(r.x0), Y(r.y0), (r.x1 - r.x0) * v.s, (r.y1 - r.y0) * v.s] as const;
  const groups = new Map((sc.groups ?? []).map(g => [g.gid, g]));
  const byId = new Map(sc.objects.map(o => [o.id!, o]));
  const font = Math.max(10, Math.min(13, 4 * v.s + 4));
  ctx.save();
  ctx.lineJoin = 'round';
  const tag = (text: string, x: number, y: number, bg: string, fg = '#000') => {
    ctx.font = `${font}px system-ui, sans-serif`;
    const w = ctx.measureText(text).width + 6;
    ctx.fillStyle = bg; ctx.fillRect(x, y - font - 3, w, font + 4);
    ctx.fillStyle = fg; ctx.fillText(text, x + 3, y - 3);
  };
  const box = (r: PxRect, color: string, lw: number, dash: number[] = []) => {
    ctx.setLineDash(dash); ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.strokeRect(...R(r)); ctx.setLineDash([]);
  };

  // ---- zones ----
  if (st.layers.zones) {
    const zs = (sc.zones ?? []).filter(z => !st.hiddenZones.has(zoneKey(z)));
    // broad areas first, keep-clear zones (hatched) on top
    const rank: Record<ZoneRec['layer'], number> = { road: 0, curb: 1, yard: 2, block: 3, keepclear: 4 };
    for (const z of [...zs].sort((a, b) => rank[a.layer] - rank[b.layer])) {
      const c = zoneColor(z);
      const [x, y, w, h] = R(z.rect);
      if (z.layer === 'keepclear') {
        ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
        ctx.strokeStyle = c; ctx.globalAlpha = 0.7; ctx.lineWidth = 1;
        const step = 6;
        for (let d = -h; d < w; d += step) { ctx.beginPath(); ctx.moveTo(x + d, y + h); ctx.lineTo(x + d + h, y); ctx.stroke(); }
        ctx.restore();
        box(z.rect, c, 1);
      } else {
        ctx.globalAlpha = z.layer === 'road' ? 0.22 : 0.28; ctx.fillStyle = c; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1;
        box(z.rect, c, 1, [4, 3]);
      }
      if (z.exp) { box(z.rect, EXP_COLOR, 3, [8, 4]); tag(`实验 ${z.exp}`, x, y, EXP_COLOR, '#fff'); }
    }
  }

  // ---- buildings: whole sprite (dashed) and solid footprint, doors ----
  if (st.layers.buildings) for (const b of sc.buildings ?? []) {
    box(b.rect, '#ffffffaa', 1, [3, 3]);
    ctx.globalAlpha = 0.18; ctx.fillStyle = '#ffffff'; ctx.fillRect(...R(b.solid)); ctx.globalAlpha = 1;
    box(b.solid, '#ffffff', 1.5);
    for (const d of b.doors) { ctx.fillStyle = '#ff9800'; ctx.beginPath(); ctx.moveTo(X(d.x) - 5, Y(d.y)); ctx.lineTo(X(d.x) + 5, Y(d.y)); ctx.lineTo(X(d.x), Y(d.y) - 7); ctx.fill(); }
  }

  // ---- groups ----
  if (st.layers.groups) {
    for (const g of sc.groups ?? []) {
      if (!g.bbox || !g.members.length || st.hiddenTypes.has(g.type) || g.type === 'bld') continue;
      const c = typeColor(g.type);
      const r = { x0: g.bbox.x0 - 1, y0: g.bbox.y0 - 1, x1: g.bbox.x1 + 1, y1: g.bbox.y1 + 1 };
      if (g.exp) { box(r, EXP_COLOR, 3, [8, 4]); tag(`实验 ${g.exp}`, X(r.x0), Y(r.y0), EXP_COLOR, '#fff'); }
      else box(r, c, 1.5);
      if (v.s >= 2) tag(g.gid, X(r.x0), Y(r.y0), c);
    }
    // experimental / novel objects get their own marks, whatever their group
    for (const o of sc.objects) {
      if (o.exp && !(o.gid && groups.get(o.gid)?.exp)) box(objBox(o), EXP_COLOR, 2.5, [6, 3]);
      if (o.novel) { const b = objBox(o); box(b, NOVEL_COLOR, 2, [2, 2]); tag('新', X(b.x1) - 4, Y(b.y0), NOVEL_COLOR); }
    }
  }

  // ---- stage 5: constraint audit ----
  const au = sc.audit;
  if (st.layers.audit && au) {
    for (const d of au.downgraded) {
      box(d.rect, AUDIT_DOWN, 2.5, [6, 3]);
      ctx.globalAlpha = 0.15; ctx.fillStyle = AUDIT_DOWN; ctx.fillRect(...R(d.rect)); ctx.globalAlpha = 1;
      tag(`降级 ${d.c}`, X(d.rect.x0), Y(d.rect.y0), AUDIT_DOWN, '#fff');
    }
    for (const g of au.regrounded ?? []) {
      box(g.rect, '#26a69a', 2, [5, 3]);
      tag(`${g.what === 'lawn' ? '改草坪' : g.what === 'pave' ? '补路' : '揭草坪'} ${g.c}`, X(g.rect.x0), Y(g.rect.y1) + font + 2, '#26a69a', '#fff');
    }
    for (const p of au.pruned) {
      const b = { x0: p.x, y0: p.y, x1: p.x + p.w, y1: p.y + p.h };
      const r = hasSprite(p.key) ? (() => { const bb = spr(p.key).bb; return { x0: p.x + bb[0], y0: p.y + bb[1], x1: p.x + bb[2], y1: p.y + bb[3] }; })() : b;
      box(r, '#bdbdbd', 1.5, [3, 2]);
      ctx.strokeStyle = '#bdbdbd'; ctx.lineWidth = 1.5; ctx.beginPath();
      ctx.moveTo(X(r.x0), Y(r.y0)); ctx.lineTo(X(r.x1), Y(r.y1)); ctx.moveTo(X(r.x1), Y(r.y0)); ctx.lineTo(X(r.x0), Y(r.y1)); ctx.stroke();
      if (v.s >= 2) tag(`删 ${p.c}`, X(r.x0), Y(r.y0), '#bdbdbd');
    }
    for (const vi of au.violations) {
      box(grow(vi.rect, 1), AUDIT_BAD, 2, [4, 2]);
      tag(vi.c, X(vi.rect.x0), Y(vi.rect.y0), AUDIT_BAD, '#fff');
    }
  }

  // ---- user labels ----
  if (st.layers.labels) for (const l of st.labels) {
    const c = l.verdict === 'good' ? GOOD : BAD;
    box(l.target.rect, c, 2.5);
    ctx.globalAlpha = 0.12; ctx.fillStyle = c; ctx.fillRect(...R(l.target.rect)); ctx.globalAlpha = 1;
    tag(`${l.verdict === 'good' ? '✓ 好' : '✗ 坏'}${l.tags.length ? ' · ' + l.tags.join('、') : ''}`, X(l.target.rect.x0), Y(l.target.rect.y1) + font + 4, c, '#000');
  }

  // ---- selection: same-group highlight, anchor line ----
  for (const [sel, strong] of [[st.hover, false], [st.pinned, true]] as const) {
    if (!sel) continue;
    if (sel.kind === 'object') {
      const o = byId.get(sel.id); if (!o) continue;
      const g = o.gid ? groups.get(o.gid) : undefined;
      if (g) for (const id of g.members) { const m = byId.get(id); if (m && m !== o) box(objBox(m), '#ffd600', strong ? 2 : 1.5); }
      const b = o.cls === 'building' ? (sc.buildings ?? []).find(bd => bd.gid === o.gid)?.rect ?? objBox(o) : objBox(o);
      box(b, '#000', strong ? 5 : 4); box(b, '#fff', strong ? 3 : 2);
      const a = o.anchor;
      if (a) {
        const fx = X((b.x0 + b.x1) / 2), fy = Y(b.y1);
        ctx.strokeStyle = '#ffd600'; ctx.lineWidth = 2; ctx.setLineDash([5, 3]);
        ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(X(a.x), Y(a.y)); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = '#ffd600'; ctx.beginPath(); ctx.arc(X(a.x), Y(a.y), 5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
        if (strong) tag(`锚点 ${a.kind}: ${a.ref}`, X(a.x) + 7, Y(a.y) + 4, '#ffd600');
      }
    } else if (sel.kind === 'region') {
      box(sel.rect, '#000', 4, [6, 4]); box(sel.rect, '#fff', 2, [6, 4]);
    } else {
      for (const z of zonesAt(sc, sel.x, sel.y).slice(0, 3)) box(z.rect, '#fff', strong ? 2.5 : 1.5, [4, 2]);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(X(sel.x) - 6, Y(sel.y)); ctx.lineTo(X(sel.x) + 6, Y(sel.y)); ctx.moveTo(X(sel.x), Y(sel.y) - 6); ctx.lineTo(X(sel.x), Y(sel.y) + 6); ctx.stroke();
    }
  }
  if (st.box) { box(st.box, '#000', 4, [6, 4]); box(st.box, '#00e5ff', 2, [6, 4]); }
  ctx.restore();
}

export type { GroupRec };
