// Generator options, and what is left of the experiments (docs/EXPERIMENTS.md keeps their history).
// exp-01, exp-03 - exp-08 are adopted: normal generator logic, always on, untagged. Since 0.7.6 there are no switches,
// no registry and no regenerating as an older version (asOf); exp-02 (整体修图) was removed with the judge (NOTE D62).
// The adopted experiments that draw random numbers still draw from the streams they had (`exp/<id>`): a stream's
// name seeds it, so renaming one would change every picture.
// A new experiment tags what it places with sb.withExp(id, ...) (objects, groups, zones carry `exp`, the annotation
// layer shows them in the experiment style); its switch is added with it.
import type { Rng } from './rng';
import type { GenOptions } from './types';

/** stage 7: a chance by novelty: base at novelty 0, always at novelty 1 */
export const fireByNovelty = (base: number) => (n: number) => base + n * (1 - base);

/** the stream of an adopted experiment (the fork and trace context it had as an experiment) */
export const expStream = (rng: Rng, id: string, novelty: number) => rng.fork(`exp/${id}`, { exp: id, novelty });

/** exp-04 (adopted): chance per occasion (a floor-modular building that may grow into a terrace, a condo / house that may be
 *  put together from parts) */
export const compositeChance = fireByNovelty(0.35);

/** exp-05 (adopted): chance that a picked residential building becomes a kit building (a shop: half of it), see pack.ts
 *  kitSwap. Twice the experiment's fireByNovelty(0.2), capped at 1 (user, 0.7.5: 出现概率翻倍) */
export const kitChance = (n: number) => Math.min(1, 2 * fireByNovelty(0.2)(n));

/** exp-08 (adopted 0.7.8): chance that a 普通街区 seed is a special district instead (district.ts mixedDistrict) */
export const districtChance = 0.2;

export const DEFAULT_OPTIONS: GenOptions = { novelty: 0.1, prune: true, pruneDraft: false, prefs: true };

export function withDefaults(o: Partial<GenOptions> = {}): GenOptions {
  return { ...DEFAULT_OPTIONS, ...o };
}
