// The viewer's random district mix (0.7.8.2): the generator never draws a district itself (generate(seed, { district })
// is always the caller's choice, as a city generator will make it per block); the viewer's 普通街区 turns a share of the
// seeds into special districts so they show up while browsing.
// Same stream and draws as the generator's mix in 0.7.8.1 (`<seed>/district/mixed`): every seed keeps its 0.7.8.1 picture.
import { Rng } from '../gen/rng';
import { DISTRICT_KINDS, type DistrictKind } from '../gen/district';

export interface DistrictMix {
  /** share of the seeds that become a special district */
  chance: number;
  /** relative weight of each kind (missing = 0) */
  weights: Partial<Record<DistrictKind, number>>;
}

/** user 0.7.8.1: one seed in five, every kind alike */
export const DEFAULT_MIX: DistrictMix = { chance: 0.2, weights: Object.fromEntries(DISTRICT_KINDS.map(k => [k, 1])) };

/** the district a seed gets under `mix` (undefined = 普通街区); deterministic in the seed */
export function mixDistrict(seed: string, mix: DistrictMix = DEFAULT_MIX): DistrictKind | undefined {
  const r = new Rng(seed).fork('district/mixed');
  const kinds = DISTRICT_KINDS.filter(k => (mix.weights[k] ?? 0) > 0);
  if (!r.choose('district.mixed', {}, { p: mix.chance }) || !kinds.length) return undefined;
  return r.choose('district.mixedKind', {}, { weights: kinds.map(k => [k, mix.weights[k]!] as const) });
}
