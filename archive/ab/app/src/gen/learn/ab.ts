// Local A/B questions (stage 7, spec 3.1); runs in the viewer's worker.
// 1. A = generateBase(seed, options with exp-02 off, no force).
// 2. Candidates = A's judgeable decisions (rng.ts judgeable: >= 2 alternatives, no JSON-shown geometry option such as
//    pack.run "[11,40]" or garden.treeHalf {"x":..}; textures are not decisions). Alternative = the option other
//    than the pick with the fewest comparisons (optPairs) in this (label, ctx); ties drawn by new Rng(`ab/<seed>`).
// 3. Sorted by score = 1/(1 + pairs) x (label in the last 20 questions ? 0.3 : 1) x (1 - 0.8 x same ratio); ties in
//    an order shuffled by the same Rng.
//    Structural decisions (layout / block streams, pack.*, bld.modularOrSingle) only take part in big questions.
// 4. In that order each candidate is generated alone with its decision forced (at most MAX_TRY = 30, the hard cap): no
//    diffItems -> its label goes to noEffect; else rect = pad(bbox(diff)), big = rect wider or taller than 192 px.
//    Soft time budget SOFT_MS = 10 s (one generateBase is ~0.9 s, so 30 probes took 10-30 s): once it is spent a
//    small question stops probing as soon as it has >= MIN_SMALL = 4 changes; with fewer it goes on to the hard cap
//    (a question of 1-3 changes is still worth the wait). A big question stops looking for a big change when the
//    budget is spent and becomes a small question. The budget is wall-clock, so which candidates are tried can vary
//    between machines; A and every change of a question are still reproducible from q (seed, options, changes).
//    No cheap no-effect filter: candidates whose stream placed nothing in A and has no forked child streams were
//    measured (first 4 regression seeds, 93 such candidates) and 35 (38 %) of them do change the picture (cars.parked false -> true,
//    exp-01 roof.ac, ...), so every candidate is probed.
// 5. Small question: greedily take !big candidates whose rect is >= 16 px from every taken one, up to 6. Big
//    question: the first big candidate alone (none -> a small question).
// 6. Verify: B = all taken changes forced together; diffItems(A, B) ids must equal the union of the single diffs.
//    Otherwise drop the changes whose rect meets an item of the symmetric difference (none -> the last one) and
//    regenerate B until equal. 0 left -> go on with the remaining candidates; still none -> changes: [].
// 7. first: forced in as change 1 (no big / structural limits, never dropped); only = a question of that one change.
import { generateBase } from '../generate';
import { withDefaults } from '../exp';
import { Rng, forceKey, alternatives, judgeable, type Ctx, type Decision } from '../rng';
import type { GenOptions, PxRect, Scene } from '../types';
import { ctxKeys } from './prefs';
import { diffItems, pad, bbox, gap, overlaps, type DiffItem } from './diff';

export const MAX_TRY = 30, SOFT_MS = 10_000, MIN_SMALL = 4, MAX_SMALL = 6, BIG_PX = 192, MIN_GAP = 16, RECENT = 20;

export interface Change { stream: string; label: string; k: number; ctx?: Ctx; a: string; b: string; rect: PxRect; big: boolean; answer?: 'a' | 'b' | 'same'; note?: string }
export interface AbQuestion { seed: string; options: GenOptions; kind: 'auto' | 'manual'; big: boolean; changes: Change[]; noEffect: string[]; tried: number; ms: number }
/** pairs: 'label|ctxKey' -> comparisons; optPairs: 'label|ctxKey|opt' -> comparisons with that option; recent: labels of
 *  the last 20 questions; same: label -> 'same' answers / answers */
export interface AbStats { pairs: Record<string, number>; optPairs: Record<string, number>; recent: string[]; same: Record<string, { same: number; n: number }> }
export interface AbRequest { seed: string; options: GenOptions; stats: AbStats; big: boolean; first?: { stream: string; label: string; k: number; b: string }; only?: boolean; maxTry?: number; softMs?: number }

export const ctxKey = (ctx?: Ctx) => ctx ? ctxKeys(ctx).join(',') : '';
export const isStructural = (d: Decision) => /^(layout|block)(\/|$)/.test(d.s) || d.label.startsWith('pack.') || d.label === 'bld.modularOrSingle';

/** recent: the labels of the last 20 questions, flattened (the caller keeps them per question; not truncated here) */
export function statsFrom(changes: { label: string; ctx?: Ctx; a: string; b: string; answer: string }[], recent: string[]): AbStats {
  const st: AbStats = { pairs: {}, optPairs: {}, recent: [...recent], same: {} };
  const inc = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };
  for (const c of changes) {
    if (!c.answer) continue;
    const pk = `${c.label}|${ctxKey(c.ctx)}`;
    inc(st.pairs, pk); inc(st.optPairs, `${pk}|${c.a}`); inc(st.optPairs, `${pk}|${c.b}`);
    const s = (st.same[c.label] ??= { same: 0, n: 0 }); s.n++; if (c.answer === 'same') s.same++;
  }
  return st;
}

/** a change under verification: forced key -> option b, its single diff and its box */
export interface VChange { key: string; b: string; items: DiffItem[]; rect: PxRect }

/** step 6: drop changes until B (all kept changes forced, from gen) differs from A by exactly the union of the single
 *  diffs. The first `keep` changes are never dropped. */
export function verify<C extends VChange>(a: Scene, cs: C[], gen: (force: Record<string, string>) => Scene, keep = 0): { kept: C[]; b: Scene } {
  let kept = [...cs];
  while (kept.length) {
    const b = gen(Object.fromEntries(kept.map(c => [c.key, c.b])));
    const d = diffItems(a, b), ids = new Set(d.map(i => i.id)), u = new Map(kept.flatMap(c => c.items.map(i => [i.id, i] as const)));
    const off = [...d.filter(i => !u.has(i.id)), ...[...u.values()].filter(i => !ids.has(i.id))];
    if (!off.length || kept.length <= keep) return { kept, b };
    const hit = kept.filter((c, j) => j >= keep && off.some(i => overlaps(c.rect, i.rect)));
    const drop = new Set(hit.length ? hit : [kept[kept.length - 1]]);
    kept = kept.filter(c => !drop.has(c));
  }
  return { kept, b: a };
}

interface Cand extends VChange { d: Decision; score: number; big: boolean }

export function makeQuestion(req: AbRequest, onProgress?: (n: number, N: number) => void): { q: AbQuestion; a: Scene; b: Scene } {
  const t0 = Date.now(), { seed, stats } = req, maxTry = req.maxTry ?? MAX_TRY, softMs = req.softMs ?? SOFT_MS;
  const spent = () => Date.now() - t0 >= softMs;
  const o = withDefaults(req.options), options: GenOptions = { ...o, exp: { ...o.exp, 'exp-02': false }, force: {} };
  const gen = (force: Record<string, string>) => generateBase(seed, { ...options, force });
  const a = gen({});
  const ds = (a.trace?.decisions ?? []) as Decision[];
  const rng = new Rng(`ab/${seed}`), noEffect: string[] = [];
  let tried = 0;

  const alt = (d: Decision) => {
    const pk = `${d.label}|${ctxKey(d.ctx)}`, n = (x: string) => stats.optPairs[`${pk}|${x}`] ?? 0;
    const xs = [...new Set(alternatives(d))].filter(x => x !== d.pick);
    if (!xs.length) return null;
    const lo = Math.min(...xs.map(n)), tied = xs.filter(x => n(x) === lo);
    return tied.length > 1 ? rng.choose('ab.alt', {}, tied) : tied[0];
  };
  const score = (d: Decision) => {
    const s = stats.same[d.label], same = s?.n ? s.same / s.n : 0;
    return 1 / (1 + (stats.pairs[`${d.label}|${ctxKey(d.ctx)}`] ?? 0)) * (stats.recent.includes(d.label) ? 0.3 : 1) * (1 - 0.8 * same);
  };
  const cand = (d: Decision, b: string): Cand => ({ d, b, key: forceKey(d.s, d.label, d.i), score: score(d), items: [], rect: { x0: 0, y0: 0, x1: 0, y1: 0 }, big: false });
  /** step 4: generate c alone; false = no visible effect */
  const probe = (c: Cand) => {
    c.items = diffItems(a, gen({ [c.key]: c.b }));
    tried++; onProgress?.(tried, maxTry);
    if (!c.items.length) { noEffect.push(c.d.label); return false; }
    c.rect = pad(bbox(c.items.map(i => i.rect))!);
    c.big = c.rect.x1 - c.rect.x0 > BIG_PX || c.rect.y1 - c.rect.y0 > BIG_PX;
    return true;
  };

  let fixed: Cand[] = [];
  const f = req.first;
  const fd = f && ds.find(d => d.s === f.stream && d.label === f.label && d.i === f.k);
  if (f && !fd) throw new Error(`decision ${forceKey(f.stream, f.label, f.k)} not in this scene`);
  if (fd) { const c = cand(fd, f!.b); if (probe(c)) fixed = [c]; }
  const bigQ = req.big && !f;

  // steps 2-3: candidate pool, best score first; ties in shuffled order (trace order would spend the whole budget on
  // the first streams, e.g. the neighbour buildings, whose cascades are big)
  const pool: Cand[] = [];
  if (!req.only) for (const d of ds) {
    if (d === fd || !judgeable(d) || (!bigQ && isStructural(d))) continue;
    const b = alt(d);
    if (b !== null) pool.push(cand(d, b));
  }
  rng.shuffle(pool).sort((x, y) => y.score - x.score);
  // probed candidates with a visible effect, in pool order; each(fn) walks them, probing more while the budget lasts
  const seen: Cand[] = [];
  let next = 0;
  // enough: checked before every new probe (the soft budget also ends a run of candidates without effect)
  const each = (fn: (c: Cand) => boolean, enough: () => boolean) => {
    for (let j = 0; ; j++) {
      while (j === seen.length) {
        if (next >= pool.length || tried >= maxTry || enough()) return;
        const c = pool[next++];
        if (probe(c)) seen.push(c);
      }
      if (fn(seen[j])) return;
    }
  };
  const failed = new Set<Cand>();
  const pick = (): Cand[] => {
    if (req.only) return fixed;
    const sel = [...fixed], free = (c: Cand) => !failed.has(c) && !sel.includes(c);
    if (bigQ) { let hit: Cand | null = null; each(c => free(c) && c.big ? (hit = c, true) : false, spent); if (hit) return [hit]; }
    each(c => {
      if (free(c) && !c.big && !isStructural(c.d) && sel.every(s => gap(s.rect, c.rect) >= MIN_GAP)) sel.push(c);
      return sel.length >= MAX_SMALL;
    }, () => sel.length >= MIN_SMALL && spent());
    return sel;
  };

  let kept: Cand[] = [], b = a;
  for (;;) {
    const sel = pick();
    if (!sel.length) break;
    const v = verify(a, sel, gen, fixed.length);
    if (v.kept.length) { kept = v.kept; b = v.b; break; }
    for (const c of sel) failed.add(c);
    if (req.only) break;
  }
  const changes: Change[] = kept.map(c => ({ stream: c.d.s, label: c.d.label, k: c.d.i, ...(c.d.ctx ? { ctx: c.d.ctx } : {}), a: c.d.pick, b: c.b, rect: c.rect, big: c.big }));
  const q: AbQuestion = { seed, options, kind: f ? 'manual' : 'auto', big: changes.some(c => c.big), changes, noEffect, tried, ms: Date.now() - t0 };
  return { q, a, b };
}
