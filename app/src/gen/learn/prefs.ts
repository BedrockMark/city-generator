// Stage 7 learned preferences: a Bradley–Terry model per decision label (spec section 4).
// Score of option o in context ctx = θ(L, o) + Σ_{key=value ∈ ctx} δ(L, key=value, o) (log multipliers); P(o_b beats o_a)
// = σ(score(o_b) − score(o_a)); a tie ("same") pulls the two scores together. L2 toward 0 (multiplier 1): λ_θ = 1, λ_δ = 4,
// so with little data a context falls back to the global multiplier, and that to 1. Labels share no parameters, so each
// label is fitted on its own (Newton, dense Hessian + Cholesky). Applied multipliers are clamped to [0.2, 5].
import type { Ctx } from '../rng';
import type { PxRect } from '../types';
import raw from '../data/prefs.json';

/** one A/B comparison of two options of a decision ('same' = tie); w: weight (A/B choice 1, label-derived < 1); stream: the
 *  decision's stream (choice files only) */
export interface Comparison { label: string; ctx: Ctx; a: string; b: string; answer: 'a' | 'b' | 'same'; w: number; batch: string; src: { seed: string; rect?: PxRect; file: string }; stream?: string }
/** multipliers m (not logs): global per option, per "key=value" per option; n = comparisons of the label */
export interface PrefEntry { global: Record<string, number>; ctx: Record<string, Record<string, number>>; n: number }
export interface PrefTable { version: string; trained: string; labels: Record<string, PrefEntry> }
/** fitted log multipliers per label */
export type PrefModel = Record<string, { theta: Record<string, number>; delta: Record<string, Record<string, number>>; n: number }>;
/** labels the user disagrees with, and (label, option) pairs as "label|option" */
export interface Blacklist { labels: string[]; options: string[] }

export const PREFS = raw as PrefTable;
export const M_MIN = 0.2, M_MAX = 5, KEEP = 0.05;

export const ctxKeys = (ctx: Ctx) => Object.keys(ctx).sort().map(k => `${k}=${ctx[k]}`);

export const filterBlacklist = (cs: Comparison[], bl: Blacklist) => {
  const labels = new Set(bl.labels), opts = new Set(bl.options);
  return cs.filter(c => !labels.has(c.label) && !opts.has(`${c.label}|${c.a}`) && !opts.has(`${c.label}|${c.b}`));
};

export function fit(cs: Comparison[], o: { lambdaTheta?: number; lambdaDelta?: number } = {}): PrefModel {
  const lt = o.lambdaTheta ?? 1, ld = o.lambdaDelta ?? 4;
  const by = new Map<string, Comparison[]>();
  for (const c of cs) if (c.a !== c.b) { const l = by.get(c.label); if (l) l.push(c); else by.set(c.label, [c]); }
  const model: PrefModel = {};
  for (const [label, lcs] of by) model[label] = fitLabel(lcs, lt, ld);
  return model;
}

/** one label: parameters = θ(o) of every option seen + δ(kv, o) of every (context value, option) seen */
function fitLabel(cs: Comparison[], lt: number, ld: number) {
  const idx = new Map<string, number>(), lam: number[] = [], meta: [string | null, string][] = [];   // meta: [kv (null = θ), option]
  const param = (kv: string | null, opt: string) => {
    const key = JSON.stringify([kv, opt]);
    let i = idx.get(key);
    if (i === undefined) { idx.set(key, i = lam.length); lam.push(kv === null ? lt : ld); meta.push([kv, opt]); }
    return i;
  };
  // per comparison: indices of score(b) − score(a) (+1 for b's params, −1 for a's), sign of the observed winner, tie
  const rows = cs.map(c => {
    const kvs = ctxKeys(c.ctx), ib = [param(null, c.b), ...kvs.map(kv => param(kv, c.b))], ia = [param(null, c.a), ...kvs.map(kv => param(kv, c.a))];
    return { ib, ia, y: c.answer === 'b' ? 1 : c.answer === 'a' ? -1 : 0, w: c.w };
  });
  const P = lam.length, x = new Array<number>(P).fill(0);
  const diff = (r: typeof rows[0], v: number[]) => r.ib.reduce((s, i) => s + v[i], 0) - r.ia.reduce((s, i) => s + v[i], 0);
  const softplus = (z: number) => z > 0 ? z + Math.log1p(Math.exp(-z)) : Math.log1p(Math.exp(z));
  const loss = (v: number[]) => {
    let f = 0;
    for (const r of rows) { const d = diff(r, v); f += r.y ? r.w * softplus(-r.y * d) : 0.5 * r.w * d * d / 2; }
    for (let i = 0; i < P; i++) f += lam[i] / 2 * v[i] * v[i];
    return f;
  };
  let f = loss(x);
  for (let it = 0; it < 50; it++) {
    const g = x.map((v, i) => lam[i] * v), H = Array.from({ length: P }, (_, i) => { const h = new Array<number>(P).fill(0); h[i] = lam[i]; return h; });
    for (const r of rows) {
      const d = diff(r, x);
      let gd: number, hd: number;   // d loss / d d, d² loss / d d²
      if (r.y) { const s = 1 / (1 + Math.exp(r.y * d)); gd = -r.y * r.w * s; hd = r.w * s * (1 - s); } else { gd = 0.5 * r.w * d; hd = 0.5 * r.w; }
      const sp: [number, number][] = [...r.ib.map(i => [i, 1] as [number, number]), ...r.ia.map(i => [i, -1] as [number, number])];
      for (const [i, si] of sp) { g[i] += gd * si; for (const [j, sj] of sp) H[i][j] += hd * si * sj; }
    }
    if (Math.hypot(...g) < 1e-6) break;
    const step = cholSolve(H, g);
    let t = 1, nx = x, nf = f;
    for (let h = 0; h < 30; h++, t /= 2) { nx = x.map((v, i) => v - t * step[i]); nf = loss(nx); if (nf <= f) break; }
    if (nf > f) break;
    x.splice(0, P, ...nx); f = nf;
  }
  const theta: Record<string, number> = {}, delta: Record<string, Record<string, number>> = {};
  meta.forEach(([kv, opt], i) => { if (kv === null) theta[opt] = x[i]; else (delta[kv] ??= {})[opt] = x[i]; });
  return { theta, delta, n: cs.length };
}

/** solve H s = g for symmetric positive definite H (L2 keeps it so) */
function cholSolve(H: number[][], g: number[]): number[] {
  const n = g.length, L = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    let s = H[i][j];
    for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
    L[i][j] = i === j ? Math.sqrt(Math.max(s, 1e-12)) : s / L[j][j];
  }
  const y = new Array<number>(n), s = new Array<number>(n);
  for (let i = 0; i < n; i++) { let v = g[i]; for (let k = 0; k < i; k++) v -= L[i][k] * y[k]; y[i] = v / L[i][i]; }
  for (let i = n - 1; i >= 0; i--) { let v = y[i]; for (let k = i + 1; k < n; k++) v -= L[k][i] * s[k]; s[i] = v / L[i][i]; }
  return s;
}

/** log score of an option (unknown label / option / context -> 0) */
export function score(model: PrefModel, label: string, ctx: Ctx, opt: string): number {
  const e = model[label];
  if (!e) return 0;
  return (e.theta[opt] ?? 0) + ctxKeys(ctx).reduce((s, kv) => s + (e.delta[kv]?.[opt] ?? 0), 0);
}

/** the stored table: multipliers with |log m| >= KEEP only */
export function toTable(model: PrefModel, version: string): PrefTable {
  const keep = (r: Record<string, number>) => {
    const o: Record<string, number> = {};
    for (const [k, v] of Object.entries(r)) if (Math.abs(v) >= KEEP) o[k] = Math.exp(v);
    return o;
  };
  const labels: Record<string, PrefEntry> = {};
  for (const [label, e] of Object.entries(model)) {
    const global = keep(e.theta), ctx: Record<string, Record<string, number>> = {};
    for (const [kv, r] of Object.entries(e.delta)) { const k = keep(r); if (Object.keys(k).length) ctx[kv] = k; }
    if (Object.keys(global).length || Object.keys(ctx).length) labels[label] = { global, ctx, n: e.n };
  }
  return { version, trained: new Date().toISOString(), labels };
}

/** applied multiplier: global and context log multipliers summed, exp, clamped to [M_MIN, M_MAX] */
export function multiplier(t: PrefTable, label: string, ctx: Ctx, opt: string): number {
  const e = t.labels[label];
  if (!e) return 1;
  let s = Math.log(e.global[opt] ?? 1);
  for (const kv of ctxKeys(ctx)) s += Math.log(e.ctx[kv]?.[opt] ?? 1);
  return Math.min(M_MAX, Math.max(M_MIN, Math.exp(s)));
}
