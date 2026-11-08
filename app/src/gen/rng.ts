// Seeded RNG (sfc32 seeded by cyrb128 string hash).
// fork(label) derives an independent stream from the ORIGINAL seed + label, so adding/removing random
// calls in one subsystem does not reshuffle every other subsystem (keeps seeds stable while iterating).
//
// Decision trace: every discrete random decision goes through choose(label, ctx, options) (or count() for
// a number of things), which draws exactly like pick / weighted / chance / int and records
// {stream, label, ctx, options, pick} into the Trace shared by all forks. The trace is written into the
// scene JSON (scene.trace) so later stages can re-weight decisions per context. Plain pick / weighted /
// chance / shuffle still work but are counted as `unlabelled` (the regression report expects 0).
// Continuous draws (positions, spacing, jitter via int / range / jitter) are geometry, not decisions.
//
// Stage 7: a decision's identity is (stream, label, k), k = how many times this label was called on this stream
// (rejected proposals included). Trace.adjust multiplies option weights (learned preferences, novelty). Without it,
// every draw is exactly the old one.

function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

export type Ctx = Record<string, string | number | boolean>;

export interface Decision {
  /** stream = fork path below the root seed (e.g. "fronts/b7"); its context is in Trace.streams */
  s: string;
  label: string;
  /** k: index of this call among the stream's calls of `label` (rejected ones included) */
  i: number;
  /** 'p' yes/no, 'count', 'order' (plain choose: absent) */
  kind?: 'p' | 'count' | 'order';
  ctx?: Ctx;
  /** number of options; opts (string form) only when there are at most MAX_OPTS */
  n: number;
  opts?: string[];
  /** weights (weighted choice) or probability of `true` (yes/no choice) */
  w?: number[];
  p?: number;
  pick: string;
  /** preference multipliers that differ from 1 (from Trace.adjust; novelty factors are not recorded) */
  m?: Record<string, number>;
}

/** weight multipliers for one decision (same length as opts, relative to the original weights); `novel`: options
 *  that count as a new texture if picked; `w0`: the multipliers without novelty (absent = original code path). A novel
 *  option is recorded only when the novelty changed the pick (w0 with the same random number picks another option).
 *  null = leave the decision alone (original code path) */
export type Adjust = (label: string, ctx: Ctx, opts: string[], stream: string) => { w: number[]; w0?: number[]; m?: Record<string, number>; novel?: string[] } | null;

/** the options a recorded decision could have taken (string form); [] = not enumerable (order, too many options) */
export function alternatives(d: Decision): string[] {
  if (d.kind === 'p') return ['true', 'false'];
  if (d.kind === 'count') { const [lo, hi] = d.opts![0].split('..').map(Number); return Array.from({ length: hi - lo + 1 }, (_, j) => String(lo + j)); }
  return d.kind !== 'order' && d.opts ? d.opts : [];
}

/** an option shown as JSON (coordinates, runs, segments: show() of an object without a name) - geometry, not judgeable */
export const isGeometryOption = (s: string) => /^[\[{]/.test(s);
/** a decision a person can compare: >= 2 alternatives, none of them (nor the pick) JSON-shown geometry. A/B candidate
 *  pools, the manual panel and the training comparisons only use these */
export const judgeable = (d: Decision) => { const xs = alternatives(d); return xs.length >= 2 && !isGeometryOption(d.pick) && !xs.some(isGeometryOption); };

const MAX_OPTS = 32;
export const show = (v: unknown): string => {
  if (v === null || v === undefined) return String(v);
  if (typeof v !== 'object') return String(v);
  const o = v as Record<string, unknown>;
  for (const k of ['key', 'fam', 'label', 'id', 'name']) if (typeof o[k] === 'string') return o[k] as string;
  return JSON.stringify(v).slice(0, 48);
};

export class Trace {
  decisions: Decision[] = [];
  /** context of each forked stream (set by fork(label, ctx)) */
  streams: Record<string, Ctx> = {};
  /** texture-level choices (asphalt variant per cell ...): only counted per label and option */
  textures: Record<string, Record<string, number>> = {};
  /** proposals that were drawn and then rejected (e.g. a building that did not fit): their decisions are
   *  dropped from `decisions`, only counted here per proposal kind */
  rejected: Record<string, number> = {};
  /** discrete draws that did not go through choose() */
  unlabelled = 0;
  /** stage 7: adjust = weight hook (see Adjust) */
  constructor(readonly root: string, readonly adjust?: Adjust) {}
  /** picked options the adjust hook marked novel: "<stream>|<option>"; novelAt: index of the decision each came from
   *  (reject() drops the entries of a rejected proposal with its decisions) */
  novel: string[] = [];
  novelAt: number[] = [];
  private counter = new Map<string, number>();
  /** next k for (stream, label) */
  tick(s: string, label: string): number { const key = `${s}|${label}`, k = this.counter.get(key) ?? 0; this.counter.set(key, k + 1); return k; }
  toJSON() { return { decisions: this.decisions, streams: this.streams, textures: this.textures, rejected: this.rejected, unlabelled: this.unlabelled }; }
}

export type Choice<T> = readonly T[] | { weights: readonly (readonly [T, number])[] };

export class Rng {
  private a: number; private b: number; private c: number; private d: number;
  /** seed: the string the generator is seeded with; path: logical stream path below the root ('' for the root),
   *  what the trace and the placements refer to */
  constructor(readonly seed: string, readonly trace?: Trace, readonly path?: string) {
    [this.a, this.b, this.c, this.d] = cyrb128(seed);
    for (let i = 0; i < 12; i++) this.next();
  }
  next(): number {
    this.a >>>= 0; this.b >>>= 0; this.c >>>= 0; this.d >>>= 0;
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }
  /** independent stream; ctx describes what the stream decides about (recorded once in the trace) */
  fork(label: string, ctx?: Ctx): Rng {
    const path = this.stream ? `${this.stream}/${label}` : label;
    const r = new Rng(`${this.seed}/${label}`, this.trace, path);
    if (ctx && this.trace) this.trace.streams[r.stream] = ctx;
    return r;
  }
  get stream(): string { return this.path ?? (this.trace ? this.seed.slice(this.trace.root.length + 1) : this.seed); }
  /** identity and adjust of one decision with n options (str(j): option j in string form). draw(w, u) makes the
   *  ordinary draw from the uniform u (w: multipliers from the hook, null = original code) and returns the option index */
  private decide(label: string, ctx: Ctx, n: number, str: (j: number) => string, draw: (w: number[] | null, u: number) => number) {
    const t = this.trace;
    if (!t) return { j: draw(null, this.next()), x: { i: 0 } };
    const s = this.stream, k = t.tick(s, label);
    let opts: string[] | null = null;
    if (t.adjust) { opts = new Array<string>(n); for (let j = 0; j < n; j++) opts[j] = str(j); }
    const a = t.adjust ? t.adjust(label, ctx, opts!, s) : null;
    const u = this.next();
    const j = draw(a ? a.w : null, u);
    // novel only when the novelty changed the pick: without it the same u picks another option
    if (a?.novel?.includes(opts![j]) && draw(a.w0 ?? null, u) !== j) { t.novel.push(`${s}|${opts![j]}`); t.novelAt.push(t.decisions.length); }
    return { j, x: { i: k, ...(a?.m ? { m: a.m } : {}) } };
  }
  private rec(d: Omit<Decision, 's'>) { this.trace?.decisions.push({ s: this.stream, ...d, ...(d.ctx && !Object.keys(d.ctx).length ? { ctx: undefined } : {}) }); }

  /** a labelled random decision. options: an array (uniform), { weights } (weighted) or { p } (yes / no).
   *  Draws exactly like pick / weighted / chance, so converting a call site never changes the picture. */
  choose<T>(label: string, ctx: Ctx, options: Choice<T>): T;
  choose(label: string, ctx: Ctx, options: { p: number }): boolean;
  choose<T>(label: string, ctx: Ctx, options: Choice<T> | { p: number }): T | boolean {
    if ('p' in options) {
      const p = options.p;
      // adjusted: odds p / (1 - p) times w[0] / w[1], back to a probability
      const { j, x } = this.decide(label, ctx, 2, j => j ? 'false' : 'true', (w, u) => {
        const q = w ? p * w[0] + (1 - p) * w[1] : 0;
        return u < (w && q > 0 ? p * w[0] / q : p) ? 0 : 1;
      });
      const v = j === 0;
      this.rec({ label, kind: 'p', ctx, n: 2, p, pick: String(v), ...x });
      return v;
    }
    if ('weights' in options) {
      const items = options.weights;
      const { j, x } = this.decide(label, ctx, items.length, j => show(items[j][0]), (w, u) => this.weightedIdx_(w ? items.map(([, v], j) => v * w[j]) : items.map(i => i[1]), u));
      const v = items[j][0];
      this.rec({ label, ctx, n: items.length, ...(items.length <= MAX_OPTS ? { opts: items.map(i => show(i[0])), w: items.map(i => i[1]) } : {}), pick: show(v), ...x });
      return v;
    }
    const arr = options as readonly T[];
    const { j, x } = this.decide(label, ctx, arr.length, j => show(arr[j]), (w, u) => w ? this.weightedIdx_(w, u) : Math.floor(u * arr.length));
    const v = arr[j];
    this.rec({ label, ctx, n: arr.length, ...(arr.length <= MAX_OPTS ? { opts: arr.map(show) } : {}), pick: show(v), ...x });
    return v;
  }
  /** a labelled count in [lo, hi] (how many tables, alleys ...); draws like int() */
  count(label: string, ctx: Ctx, lo: number, hi: number): number {
    const n = hi - lo + 1;
    const { j, x } = this.decide(label, ctx, n, j => String(lo + j), (w, u) => w ? this.weightedIdx_(w, u) : Math.floor(u * n));
    const v = lo + j;
    this.rec({ label, kind: 'count', ctx, n, opts: [`${lo}..${hi}`], pick: String(v), ...x });
    return v;
  }
  /** texture variation (one per ground cell ...): weighted draw, aggregated in the trace instead of one record each */
  tex<T>(label: string, options: Choice<T>): T {
    const v = 'weights' in options ? this.weighted_(options.weights) : (options as readonly T[])[Math.floor(this.next() * (options as readonly T[]).length)];
    if (this.trace) { const t = (this.trace.textures[label] ??= {}); const k = show(v); t[k] = (t[k] ?? 0) + 1; }
    return v;
  }
  /** start of a proposal: pass the result to reject() if the proposal is thrown away */
  mark(): number { return this.trace?.decisions.length ?? 0; }
  /** drop the decisions recorded since `mark` (a rejected proposal of kind `what`); the draws themselves stay */
  reject(mark: number, what: string) {
    if (!this.trace) return;
    this.trace.decisions.length = mark;
    const t = this.trace; let n = t.novelAt.length; while (n && t.novelAt[n - 1] >= mark) n--;
    t.novel.length = t.novelAt.length = n;
    this.trace.rejected[what] = (this.trace.rejected[what] ?? 0) + 1;
  }
  /** labelled shuffle (in place); records the resulting order */
  order<T>(label: string, ctx: Ctx, arr: T[]): T[] {
    const i = this.trace ? this.trace.tick(this.stream, label) : 0;   // counted
    this.shuffle_(arr);
    this.rec({ label, i, kind: 'order', ctx, n: arr.length, pick: arr.map(show).join(',').slice(0, 80) });
    return arr;
  }

  /** integer in [lo, hi] inclusive */
  int(lo: number, hi: number): number { return lo + Math.floor(this.next() * (hi - lo + 1)); }
  range(lo: number, hi: number): number { return lo + this.next() * (hi - lo); }
  chance(p: number): boolean { this.unl(); return this.next() < p; }
  pick<T>(arr: readonly T[]): T { this.unl(); return arr[Math.floor(this.next() * arr.length)]; }
  weighted<T>(items: readonly (readonly [T, number])[]): T { this.unl(); return this.weighted_(items); }
  shuffle<T>(arr: T[]): T[] { this.unl(); return this.shuffle_(arr); }
  private unl() { if (this.trace) this.trace.unlabelled++; }
  private weighted_<T>(items: readonly (readonly [T, number])[]): T { return items[this.weightedIdx_(items.map(i => i[1]))][0]; }
  private weightedIdx_(ws: readonly number[], u = this.next()): number {
    const tot = ws.reduce((s, w) => s + w, 0);
    let r = u * tot;
    for (let j = 0; j < ws.length; j++) { if ((r -= ws[j]) < 0) return j; }
    return ws.length - 1;
  }
  private shuffle_<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(this.next() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr;
  }
  /** small symmetric jitter, roughly triangular in [-m, m] */
  jitter(m: number): number { return Math.round((this.next() + this.next() - 1) * m); }
}
