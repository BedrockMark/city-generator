// Experimental features: registry and switches (docs/EXPERIMENTS.md mirrors this list).
// An experiment draws from its own stream (rng.fork(`exp/<id>`)) and emits inside sb.withExp(id, ...), so
// - everything it produces carries `exp: '<id>'` (objects, groups, zones) and the viewer styles it apart;
// - switching it off leaves every other stream, hence the rest of the picture, as unchanged as possible.
// Status: experimental -> adopted (becomes normal generator logic, no tag, always on) or retired (never runs).
// Promotion / retirement follows the user's good / bad labels on its output, after asking the user.
import type { Rng } from './rng';
import type { GenOptions } from './types';

export interface Experiment {
  id: string;            // exp-NN
  title: string;
  status: 'experimental' | 'adopted' | 'retired';
  /** switched on unless the user turns it off */
  default: boolean;
  /** chance that an enabled experiment fires in a given scene, by novelty (0..1); default always */
  fire?: (novelty: number) => number;
}

export const EXPERIMENTS: Experiment[] = [
  // none yet: the first requested experimental feature becomes exp-01
];

export const DEFAULT_OPTIONS: GenOptions = { novelty: 0.1, experiments: true, exp: {}, prune: true, pruneDraft: false };

export function withDefaults(o: Partial<GenOptions> = {}): GenOptions {
  return { ...DEFAULT_OPTIONS, ...o, exp: { ...DEFAULT_OPTIONS.exp, ...(o.exp ?? {}) } };
}

/** switch state (master switch + per-feature switch), independent of chance */
export function expEnabled(o: GenOptions, id: string): boolean {
  const e = EXPERIMENTS.find(x => x.id === id);
  if (!e || e.status === 'retired') return false;
  if (e.status === 'adopted') return true;
  return o.experiments && (o.exp[id] ?? e.default);
}

/** does experiment `id` run in this scene? Decided on the experiment's own stream (labelled in the trace). */
export function expFires(o: GenOptions, id: string, root: Rng): Rng | null {
  if (!expEnabled(o, id)) return null;
  const e = EXPERIMENTS.find(x => x.id === id)!;
  const r = root.fork(`exp/${id}`, { exp: id, novelty: o.novelty });
  if (e.status === 'experimental' && e.fire && !r.choose('exp.fire', { novelty: o.novelty }, { p: e.fire(o.novelty) })) return null;
  return r;
}
