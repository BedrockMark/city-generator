// 整体修图 (experiment exp-02, stage 6; v0.6.1 D45): when the map is odder than the references (map mean above the
// references' 90th percentile + 0.1 * novelty, stage 7), the main block is re-packed GLOBAL_SALTS times (salt on the
// `block` stream, rng.ts reseed) and the re-pack with the lowest map mean is kept, provided it leaves no more active-constraint violations
// than the original. Nothing is edited window by window (the v0.6.0 local tier — re-seeding single windows,
// downgrades — is gone: the user found its changes meaningless, and the re-packs alone gave the same constraint gains).
// The adopted salt is written into scene.options (reseed, judgeFixed), so an exported scene JSON regenerates exactly,
// without searching again.
import { generateBase } from '../generate';
import { alignScene } from './align';
import { scoreWorld, MODEL } from './model';
import type { Audit } from '../rational/rationalize';
import { CONSTRAINTS } from '../rational/constraints';
import type { GenOptions, Scene } from '../types';

export const EXP_ID = 'exp-02';
export const GLOBAL_SALTS = 4;
const ACTIVE = CONSTRAINTS.filter(c => c.status === 'active').map(c => c.id);

export interface JudgeRepair {
  reseed: Record<string, number>;
  /** every re-pack tried (absent when the map was not odd enough to try) */
  global?: { salt: number; mean: number; violations: number; ok: boolean }[]; globalAdopted?: number;
  meanBefore: number; meanAfter: number; ms: number; gens: number;
}

/** remaining violations of the active constraints */
export const violationCount = (au?: Audit) => ACTIVE.reduce((s, c) => s + (au?.counts[c] ?? 0), 0);

/** global tier adopted: the whole main block was re-packed, everything but the neighbour blocks is exp-02's */
export function tagGlobal(sc: Scene) {
  const neigh = (s?: string) => s !== undefined && /^(neigh|nfronts|island)(\/|$)/.test(s);
  for (const o of sc.objects) if (!neigh(o.stream)) o.exp ??= EXP_ID;
  for (const g of sc.groups ?? []) if (!neigh(g.stream)) g.exp ??= EXP_ID;
  for (const z of sc.zones ?? []) if (!neigh(z.stream)) z.exp ??= EXP_ID;
}

/** the scene for the given salts, scored */
export function build(seed: string, opts: GenOptions, reseed: Record<string, number>): Scene {
  const sc = generateBase(seed, { ...opts, reseed });
  sc.judge = scoreWorld(alignScene(sc), undefined, opts.novelty);
  return sc;
}

export function judgeRepair(seed: string, opts: GenOptions, base: Scene, onProgress?: (n: number, N: number) => void): Scene {
  const t0 = Date.now();
  const start = { scene: base, judge: base.judge ?? scoreWorld(alignScene(base), undefined, opts.novelty), violations: violationCount(base.audit) };
  const rec: JudgeRepair = { reseed: { ...(opts.reseed ?? {}) }, meanBefore: start.judge.mean, meanAfter: start.judge.mean, ms: 0, gens: 0 };
  let best = start, bestReseed = rec.reseed;
  // stage 7: novelty relaxes the trigger line
  if (start.judge.mean > MODEL.refMeanP90 + 0.1 * opts.novelty) {
    rec.global = [];
    for (let g = 1; g <= GLOBAL_SALTS; g++) {
      const reseed = { ...(opts.reseed ?? {}), block: g };
      const scene = build(seed, opts, reseed); rec.gens++;
      onProgress?.(g, GLOBAL_SALTS);
      const c = { scene, judge: scene.judge!, violations: violationCount(scene.audit) };
      const ok = c.violations <= start.violations;
      rec.global.push({ salt: g, mean: c.judge.mean, violations: c.violations, ok });
      if (ok && c.judge.mean < best.judge.mean) { best = c; bestReseed = reseed; rec.globalAdopted = g; }
    }
  }
  rec.reseed = bestReseed; rec.meanAfter = best.judge.mean; rec.ms = Date.now() - t0;
  if (best === start) { base.judgeRepair = rec; return base; }
  const sc = best.scene;
  tagGlobal(sc);
  sc.options = { ...opts, reseed: bestReseed, judgeFixed: { global: true } };
  sc.judgeRepair = rec;
  return sc;
}
