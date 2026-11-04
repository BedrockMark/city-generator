// Stage 6 judge repair (experiment exp-02; spec 3). The judge scores every window; the worst windows (above the
// threshold) and the windows holding a report-only constraint violation (C19, C23, C24: left for re-seeding in
// stage 5, D31) are repaired by re-drawing the random streams that placed what stands in them:
// - local tier: salt 1..6 on those streams (rng.ts reseed), the whole map regenerated each time (constraint repairs
//   included), a candidate qualifies when (1) it leaves no more active-constraint violations, (2) the windows
//   elsewhere get worse by at most 0.05 per window in total, (3) the target window improves (or its violation is gone);
//   the qualifying candidate with the lowest target score is adopted, and the next window builds on it;
// - no candidate qualifies and the window is still above the threshold: downgrade (宁删勿补) — the yard pieces in
//   it turn to lawn / keep only their plants, weakly anchored decorations go; nothing is added; kept only if (1) holds
//   and the window score drops;
// - global tier (options.judgeGlobal, off by default): the main block re-packed (salt on `block`), each candidate
//   through the local tier again.
// The adopted salts and downgrades are written into scene.options (reseed, judgeFixed), so an exported scene JSON
// regenerates exactly, without searching again.
import { generateBase } from '../generate';
import { alignScene, objBox } from './align';
import { scoreWorld, MODEL, type JudgeResult } from './model';
import { rationalize, lawn, type Audit } from '../rational/rationalize';
import { CONSTRAINTS } from '../rational/constraints';
import type { GenOptions, PxRect, Scene } from '../types';
import semclassRaw from '../data/semclass.json';

export const EXP_ID = 'exp-02';
export const REPORT_ONLY = ['C19', 'C23', 'C24'];
export const SALTS = 6, MAX_TARGETS = 3, GLOBAL_SALTS = 4, OUTSIDE_TOL = 0.05;
const SEMCLASS = semclassRaw as Record<string, string>;
const ACTIVE = CONSTRAINTS.filter(c => c.status === 'active').map(c => c.id);

export interface Target { rect: PxRect; score: number; why: 'score' | string }
export interface Cand { scene: Scene; judge: JudgeResult; violations: number; reseed: Record<string, number> }
export interface RepairWin {
  rect: PxRect; why: string; before: number; after: number;
  cands: { salt: number; score: number; violations: number; ok: boolean; why: string }[];
  adopted?: number; degraded?: { zones: string[]; removed: string[] } | 'rejected';
  /** not worked on: an earlier window's adoption already fixed it */
  skipped?: string;
}
export interface JudgeRepair {
  windows: RepairWin[]; reseed: Record<string, number>; degrade: PxRect[];
  global?: { salt: number; mean: number; violations: number; ok: boolean }[]; globalAdopted?: number;
  meanBefore: number; meanAfter: number; ms: number; gens: number;
}

const overlaps = (a: PxRect, b: PxRect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const inRect = (r: PxRect, x: number, y: number) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;
const key = (r: PxRect) => `${r.x0},${r.y0}`;
const centre = (r: PxRect) => [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2] as const;
const footOf = (o: Scene['objects'][number]) => { const b = objBox(o); return [(b.x0 + b.x1) / 2, b.y1 - 1] as const; };

/** remaining violations of the active constraints */
export const violationCount = (au?: Audit) => ACTIVE.reduce((s, c) => s + (au?.counts[c] ?? 0), 0);

/** windows to repair: above the threshold, or holding a report-only violation; greedy by score, no overlaps, at most 3 */
export function selectTargets(j: JudgeResult, au: Audit | undefined, threshold: number): Target[] {
  const cands: Target[] = j.windows.filter(w => w.score > threshold).map(w => ({ rect: w.rect, score: w.score, why: 'score' }));
  for (const v of au?.violations ?? []) {
    if (!REPORT_ONLY.includes(v.c)) continue;
    const [cx, cy] = centre(v.rect);
    const w = j.windows.filter(w => inRect(w.rect, cx, cy)).sort((a, b) => b.score - a.score)[0];
    if (w && !cands.some(t => t.why === v.c && key(t.rect) === key(w.rect))) cands.push({ rect: w.rect, score: w.score, why: v.c });
  }
  cands.sort((a, b) => b.score - a.score);
  const out: Target[] = [];
  for (const t of cands) {
    if (out.length >= MAX_TARGETS) break;
    if (!out.some(o => overlaps(o.rect, t.rect))) out.push(t);
  }
  return out;
}

const STRUCTURAL = (s: string) => !s || s === 'yard' || /^(layout|block|neigh)(\/|$)/.test(s) || s.startsWith('exp/');

/** the random streams that placed what stands in the window (objects by their foot, yard pieces overlapping it) */
export function saltableStreams(sc: Scene, rect: PxRect): string[] {
  const out = new Set<string>();
  for (const o of sc.objects) {
    if (o.cls === 'building' || o.stream === undefined) continue;
    const [fx, fy] = footOf(o);
    if (inRect(rect, fx, fy) && !STRUCTURAL(o.stream)) out.add(o.stream);
  }
  for (const z of sc.zones ?? []) if (z.layer === 'yard' && z.stream !== undefined && !STRUCTURAL(z.stream) && overlaps(z.rect, rect)) out.add(z.stream);
  return [...out];
}

const scoreAt = (j: JudgeResult, r: PxRect) => j.windows.find(w => key(w.rect) === key(r))?.score;

/** report-only violation of constraint `c` with its centre in the window */
const holds = (au: Audit | undefined, c: string, r: PxRect) => (au?.violations ?? []).some(v => v.c === c && inRect(r, ...centre(v.rect)));

/** a target still worth working on when its turn comes (an earlier adoption may have fixed it already) */
export function stillNeeded(cur: Cand, t: Target, threshold: number): boolean {
  return t.why === 'score' ? (scoreAt(cur.judge, t.rect) ?? 0) > threshold : holds(cur.scene.audit, t.why, t.rect);
}

export function qualifies(orig: Cand, cand: Cand, t: Target): { ok: boolean; why: string } {
  if (cand.violations > orig.violations) return { ok: false, why: `约束违规 ${orig.violations} → ${cand.violations}` };
  let delta = 0, n = 0;
  for (const w of orig.judge.windows) {
    if (overlaps(w.rect, t.rect)) continue;
    const s = scoreAt(cand.judge, w.rect);
    if (s === undefined) continue;
    delta += s - w.score; n++;
  }
  if (delta > OUTSIDE_TOL * n) return { ok: false, why: `窗口外变差 ${delta.toFixed(2)} > ${(OUTSIDE_TOL * n).toFixed(2)}` };
  if (t.why === 'score') {
    const a = scoreAt(orig.judge, t.rect) ?? t.score, b = scoreAt(cand.judge, t.rect);
    if (b === undefined || b >= a) return { ok: false, why: `目标窗口没有变好（${a.toFixed(3)} → ${b?.toFixed(3) ?? '—'}）` };
  } else if (holds(cand.scene.audit, t.why, t.rect)) return { ok: false, why: `${t.why} 违规仍在` };
  return { ok: true, why: '合格' };
}

const DECOR = new Set(['crate', 'other', 'utility', 'info_sign']);
const WEAK = new Set(['zone', 'yard', 'block', 'slot']);
const LAWN_KINDS = new Set(['garden', 'strip', 'service', 'paved']);
const isPlant = (key: string) => { const c = SEMCLASS[key]; return c === 'tree' || c === 'plant'; };

/** 宁删勿补: yard pieces centred in the window -> lawn and plants only (garden, strip, service corner, plain paving);
 *  decorations in the window that hang off no door / curb / object (weak anchor: zone, yard, block, slot) go.
 *  Nothing is added. Mutates the scene. */
export function degradeWindow(sc: Scene, rect: PxRect): { zones: string[]; removed: string[] } {
  const zones: string[] = [], gone = new Set<string>();
  for (const z of sc.zones ?? []) {
    if (z.layer !== 'yard' || !LAWN_KINDS.has(z.kind) || !inRect(rect, ...centre(z.rect))) continue;
    zones.push(z.id);
    z.reason += '（阶段 6 降级：评判修复 exp-02 → 草坪，只留植物）';
    z.exp ??= EXP_ID;
    lawn(sc, z.rect);
    for (const o of sc.objects) {
      if (o.cls === 'building' || o.exp || isPlant(o.key)) continue;
      if (inRect(z.rect, ...footOf(o))) gone.add(o.id!);
    }
    if (z.gid) sc.zones = sc.zones!.filter(k => !(k.layer === 'keepclear' && k.gid === z.gid));
  }
  for (const o of sc.objects) {
    if (o.cls === 'building' || o.exp || !o.anchor || !WEAK.has(o.anchor.kind) || !DECOR.has(SEMCLASS[o.key] ?? 'other')) continue;
    if (inRect(rect, ...footOf(o))) gone.add(o.id!);
  }
  sc.objects = sc.objects.filter(o => !gone.has(o.id!));
  for (const g of sc.groups ?? []) g.members = g.members.filter(m => !gone.has(m));
  return { zones, removed: [...gone] };
}

/** re-judge the constraints after a downgrade; earlier prunes stay on the record */
function reaudit(sc: Scene, opts: GenOptions) {
  const prev = sc.audit;
  const au = rationalize(sc, opts);
  if (prev) { au.pruned = [...prev.pruned, ...au.pruned]; au.downgraded = [...prev.downgraded, ...au.downgraded]; au.regrounded = [...prev.regrounded, ...au.regrounded]; au.before = prev.before; }
  sc.audit = au;
}

/** tag what the salted streams placed, and the downgraded zones, as produced by exp-02 */
function tag(sc: Scene, reseed: Record<string, number>) {
  const salted = Object.keys(reseed);
  const hit = (s?: string) => s !== undefined && salted.some(k => s === k || s.startsWith(k + '/'));
  for (const o of sc.objects) if (hit(o.stream)) o.exp ??= EXP_ID;
  for (const g of sc.groups ?? []) if (hit(g.stream)) g.exp ??= EXP_ID;
  for (const z of sc.zones ?? []) if (hit(z.stream)) z.exp ??= EXP_ID;
}

/** global tier adopted: the whole main block was re-packed, everything but the neighbour blocks is exp-02's */
export function tagGlobal(sc: Scene) {
  const neigh = (s?: string) => s !== undefined && /^(neigh|nfronts|island)(\/|$)/.test(s);
  for (const o of sc.objects) if (!neigh(o.stream)) o.exp ??= EXP_ID;
  for (const g of sc.groups ?? []) if (!neigh(g.stream)) g.exp ??= EXP_ID;
  for (const z of sc.zones ?? []) if (!neigh(z.stream)) z.exp ??= EXP_ID;
}

/** the scene for the given salts and downgrades: generateBase + downgrades + re-audit, scored, tagged */
export function build(seed: string, opts: GenOptions, reseed: Record<string, number>, degrade: PxRect[]): Scene {
  const sc = generateBase(seed, { ...opts, reseed });
  for (const r of degrade) degradeWindow(sc, r);
  if (degrade.length) reaudit(sc, opts);
  tag(sc, reseed);
  sc.judge = scoreWorld(alignScene(sc));
  return sc;
}

const asCand = (scene: Scene, reseed: Record<string, number>): Cand => ({ scene, judge: scene.judge ?? scoreWorld(alignScene(scene)), violations: violationCount(scene.audit), reseed });

/** local tier on top of `start` (salts `base` + degrades so far); returns the adopted candidate and its record */
function localTier(seed: string, opts: GenOptions, start: Cand, degrade: PxRect[], step: () => void): { cur: Cand; windows: RepairWin[]; degrade: PxRect[]; gens: number } {
  let cur = start, gens = 0;
  const windows: RepairWin[] = [];
  degrade = [...degrade];
  for (const t of selectTargets(cur.judge, cur.scene.audit, MODEL.threshold)) {
    const before = scoreAt(cur.judge, t.rect) ?? t.score;
    const rec: RepairWin = { rect: t.rect, why: t.why, before, after: before, cands: [] };
    if (!stillNeeded(cur, t, MODEL.threshold)) { rec.skipped = '前面的窗口修好后它已经不需要修'; windows.push(rec); for (let i = 0; i < SALTS; i++) step(); continue; }
    const streams = saltableStreams(cur.scene, t.rect);
    let best: { c: Cand; salt: number } | undefined;
    for (let salt = 1; salt <= SALTS; salt++) {
      step();
      if (!streams.length) continue;
      const reseed = { ...cur.reseed };
      for (const s of streams) reseed[s] = salt;
      const c = asCand(build(seed, opts, reseed, degrade), reseed); gens++;
      const q = qualifies(cur, c, t);
      const sc = scoreAt(c.judge, t.rect) ?? 1;
      rec.cands.push({ salt, score: sc, violations: c.violations, ok: q.ok, why: streams.length ? q.why : '窗口里没有可换的随机流' });
      if (q.ok && (!best || sc < (scoreAt(best.c.judge, t.rect) ?? 1))) best = { c, salt };
    }
    if (best) { cur = best.c; rec.adopted = best.salt; rec.after = scoreAt(cur.judge, t.rect) ?? before; }
    else if (t.why === 'score' && before > MODEL.threshold) {
      // what the downgrade would do here (on a copy); nothing to take away = nothing to record
      const effect = degradeWindow(structuredClone(cur.scene), t.rect);
      if (effect.zones.length + effect.removed.length) {
        const trial = [...degrade, t.rect];
        const c = asCand(build(seed, opts, cur.reseed, trial), cur.reseed); gens++;
        // kept only when the constraints do not get worse and the window does get better
        const after = scoreAt(c.judge, t.rect) ?? before;
        if (c.violations <= cur.violations && after < before) { degrade = trial; cur = c; rec.degraded = effect; rec.after = after; }
        else rec.degraded = 'rejected';
      }
    }
    windows.push(rec);
  }
  return { cur, windows, degrade, gens };
}

export function judgeRepair(seed: string, opts: GenOptions, base: Scene, onProgress?: (n: number, N: number) => void): Scene {
  const t0 = Date.now();
  const start = asCand(base, { ...(opts.reseed ?? {}) });
  const targets = selectTargets(start.judge, base.audit, MODEL.threshold);
  if (!targets.length && !opts.judgeGlobal) return base;
  let n = 0;
  const N = MAX_TARGETS * SALTS * (opts.judgeGlobal ? 1 + GLOBAL_SALTS : 1);
  const step = () => onProgress?.(++n, N);
  const local = localTier(seed, opts, start, [], step);
  let { cur, degrade } = local, gens = local.gens, windows = local.windows;
  const rec: JudgeRepair = { windows, reseed: {}, degrade: [], meanBefore: start.judge.mean, meanAfter: 0, ms: 0, gens: 0 };
  if (opts.judgeGlobal && cur.judge.mean > MODEL.refMeanP90) {
    rec.global = [];
    let bestG: { cur: Cand; windows: RepairWin[]; degrade: PxRect[]; salt: number } | undefined;
    for (let g = 1; g <= GLOBAL_SALTS; g++) {
      const reseed = { ...(opts.reseed ?? {}), block: g };
      const c0 = asCand(build(seed, opts, reseed, []), reseed); gens++;
      const l = localTier(seed, opts, c0, [], step); gens += l.gens;
      const ok = l.cur.violations <= start.violations;
      rec.global.push({ salt: g, mean: l.cur.judge.mean, violations: l.cur.violations, ok });
      if (ok && l.cur.judge.mean < (bestG?.cur.judge.mean ?? cur.judge.mean)) bestG = { ...l, salt: g };
    }
    if (bestG) { cur = bestG.cur; degrade = bestG.degrade; windows = bestG.windows; rec.windows = windows; rec.globalAdopted = bestG.salt; }
  }
  const sc = cur.scene;
  if (rec.globalAdopted !== undefined) tagGlobal(sc);
  rec.reseed = cur.reseed; rec.degrade = degrade;
  rec.meanAfter = cur.judge.mean; rec.ms = Date.now() - t0; rec.gens = gens;
  const changed = Object.keys(cur.reseed).length > Object.keys(opts.reseed ?? {}).length || degrade.length > 0;
  if (!changed) { base.judgeRepair = rec; return base; }
  sc.options = { ...opts, reseed: cur.reseed, judgeFixed: { degrade, global: rec.globalAdopted !== undefined } };
  sc.judgeRepair = rec;
  return sc;
}
