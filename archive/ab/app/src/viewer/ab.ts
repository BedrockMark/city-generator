// Viewer A/B mode (stage 7, spec 3.2-3.4; key B). The question is built in the worker (learn/ab.ts makeQuestion);
// this file keeps the session (question number, labels of the last 20 questions, answer stats for the next
// question), draws the numbered change boxes and talks to /api/choices (vite.config.ts):
//   POST { version, seed, data } -> references/choices/v<version>/seed<seed>_<YYYYMMDD-HHMMSS>.json
//   GET -> { changes: [{ label, ctx, a, b, answer, created }] } of every version (question scoring)
// A failed save keeps the record in localStorage (PENDING); flushPending posts those later.
import type { Scene } from '../gen/types';
import type { Ctx } from '../gen/rng';
import { statsFrom, RECENT, type AbQuestion, type AbStats, type Change } from '../gen/learn/ab';
import { ctxKeys } from '../gen/learn/prefs';
import type { View } from './overlay';

export type Answer = 'a' | 'b' | 'same';
export interface Past { label: string; ctx?: Ctx; a: string; b: string; answer: string; created?: string }

/** box colours: unanswered, A better, B better, about the same */
export const AB_COLORS = { none: '#ffeb3b', a: '#36d36b', b: '#2196f3', same: '#9e9e9e' } as const;
export const ANSWER_NAMES: Record<Answer, string> = { a: 'A 好', b: 'B 好', same: '差不多' };
/** questions 5, 10, ... ask for one big change */
export const BIG_EVERY = 5;
/** gap between A and B in the side-by-side view: 2 cells */
export const SIDE_GAP = 32;

export const ctxText = (ctx?: Ctx) => ctx && Object.keys(ctx).length ? ctxKeys(ctx).join(', ') : '';
/** "yard.parking（rows=2）：parking → garden" */
export const changeText = (c: Pick<Change, 'label' | 'ctx' | 'a' | 'b'>) => `${c.label}${ctxText(c.ctx) ? `（${ctxText(c.ctx)}）` : ''}：${c.a} → ${c.b}`;

export class AbSession {
  /** number of the current (or last) question, 1-based; counted when a question arrives */
  n = 0;
  /** labels of each of the last 20 questions */
  recentQs: string[][] = [];
  /** answered changes: saved files of every version (loaded once) + this session's */
  past: Past[] = [];
  loaded = false;
  private loading?: Promise<void>;
  cur?: { q: AbQuestion; a: Scene; b: Scene };
  /** selected change (index into cur.q.changes), -1 = none */
  sel = -1;

  get stats(): AbStats { return statsFrom(this.past, this.recentQs.flat()); }
  /** the question being requested (n + 1) is big */
  get big() { return (this.n + 1) % BIG_EVERY === 0; }

  /** once; concurrent callers share the request */
  load() { return (this.loading ??= this.load_()); }
  private async load_() {
    await flushPending();   // answers kept in the browser by a failed save go to the server first, so they count
    try {
      const r = await fetch('/api/choices');
      if (r.ok) this.past = ((await r.json()) as { changes: Past[] }).changes ?? [];
    } catch { /* no dev server: start from no answers */ }
    this.loaded = true;
  }

  /** a new question arrived */
  set(cur: { q: AbQuestion; a: Scene; b: Scene }) {
    this.n++;
    this.cur = cur; this.sel = cur.q.changes.length ? 0 : -1;
    this.recentQs = [...this.recentQs, [...new Set(cur.q.changes.map(c => c.label))]].slice(-RECENT);
  }

  answer(ans: Answer) {
    const cs = this.cur?.q.changes; if (!cs?.length) return;
    if (this.sel < 0) this.sel = 0;
    cs[this.sel].answer = ans;
    // move on to the next unanswered change, if any
    const nx = cs.findIndex((c, j) => j > this.sel && !c.answer), any = cs.findIndex(c => !c.answer);
    if (nx >= 0) this.sel = nx; else if (any >= 0) this.sel = any;
  }

  /** the choices file of the current question (spec 3.4), null = nothing answered */
  record(): Record<string, unknown> | null {
    const q = this.cur?.q; if (!q) return null;
    const cs = q.changes.filter(c => c.answer);
    if (!cs.length) return null;
    const { force: _f, ...options } = q.options;
    return {
      version: this.cur!.a.version, seed: q.seed, options, novelty: q.options.novelty, created: new Date().toISOString(), kind: q.kind,
      changes: cs.map(c => ({ stream: c.stream, label: c.label, k: c.k, ...(c.ctx ? { ctx: c.ctx } : {}), a: c.a, b: c.b, rect: c.rect, answer: c.answer, ...(c.note ? { note: c.note } : {}) })),
    };
  }

  /** save the answered changes (POST /api/choices); they count in the stats from now on. Returns the file name, '' =
   *  nothing to save. Without the dev server the record goes to localStorage. */
  async save(): Promise<string> {
    const rec = this.record(); if (!rec) return '';
    const cs = rec.changes as Past[];
    this.past.push(...cs.map(c => ({ ...c, created: rec.created as string })));
    try {
      const r = await fetch('/api/choices', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version: rec.version, seed: rec.seed, data: rec }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.status);
      void flushPending();
      return j.file as string;
    } catch (e) {
      const xs = JSON.parse(localStorage.getItem(PENDING) ?? '[]');
      localStorage.setItem(PENDING, JSON.stringify([...xs, rec]));
      throw e;
    }
  }
}

/** choice records a failed save kept in the browser (localStorage) */
export const PENDING = 'citygen.choices.pending';
let flushing: Promise<void> | undefined;
/** post every pending record (on entering the A/B mode and after each successful save); the ones the server took are
 *  removed, the others stay for the next try */
export function flushPending(): Promise<void> {
  if (flushing) return flushing;
  const run = async () => {
    try {
      const xs = JSON.parse(localStorage.getItem(PENDING) ?? '[]') as Record<string, unknown>[];
      if (!xs.length) return;
      const left: Record<string, unknown>[] = [];
      for (const rec of xs) {
        try {
          const r = await fetch('/api/choices', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version: rec.version, seed: rec.seed, data: rec }) });
          if (!r.ok) left.push(rec);
        } catch { left.push(rec); }
      }
      // records added while flushing stay too
      const now = JSON.parse(localStorage.getItem(PENDING) ?? '[]') as unknown[];
      const rest = [...left, ...now.slice(xs.length)];
      if (rest.length) localStorage.setItem(PENDING, JSON.stringify(rest)); else localStorage.removeItem(PENDING);
    } catch { /* no localStorage / broken entry: nothing to flush */ }
  };
  return (flushing = run().finally(() => { flushing = undefined; }));
}

/** numbered solid change boxes; dxs = world x offsets to draw them at (side-by-side: [0, W + gap]) */
export function drawAb(ctx: CanvasRenderingContext2D, q: AbQuestion, v: View, sel: number, dxs: number[] = [0]) {
  const X = (x: number) => (x - v.ox) * v.s, Y = (y: number) => (y - v.oy) * v.s;
  ctx.save();
  ctx.font = 'bold 12px system-ui, sans-serif'; ctx.textBaseline = 'top';
  for (const dx of dxs) q.changes.forEach((c, j) => {
    const col = AB_COLORS[c.answer ?? 'none'], on = j === sel, r = c.rect;
    const x = X(r.x0 + dx), y = Y(r.y0), w = (r.x1 - r.x0) * v.s, h = (r.y1 - r.y0) * v.s;
    if (on) { ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x, y, w, h); }
    ctx.setLineDash([]);
    if (on) { ctx.lineWidth = 5; ctx.strokeStyle = '#000a'; ctx.strokeRect(x, y, w, h); }
    ctx.lineWidth = on ? 3 : 2; ctx.strokeStyle = col; ctx.strokeRect(x, y, w, h);
    const t = String(j + 1), tw = ctx.measureText(t).width + 8;
    ctx.fillStyle = col; ctx.fillRect(x, y - 16, tw, 16);
    ctx.fillStyle = '#000'; ctx.fillText(t, x + 4, y - 14);
  });
  ctx.restore();
}

/** index of the change whose box (at any of dxs) contains the world point, -1 = none; smallest box first */
export function abAt(q: AbQuestion, x: number, y: number, dxs: number[] = [0]): number {
  let best = -1, area = Infinity;
  q.changes.forEach((c, j) => {
    const r = c.rect, a = (r.x1 - r.x0) * (r.y1 - r.y0);
    if (dxs.some(dx => x - dx >= r.x0 && x - dx < r.x1 && y >= r.y0 && y < r.y1) && a < area) { best = j; area = a; }
  });
  return best;
}
