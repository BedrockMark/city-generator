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
  // 2026-11-03, user label 684358 L3 + v0.5.0 question 2: AC units belong on flat roofs, not on the ground
  { id: 'exp-01', title: '平顶屋顶上的空调外机', status: 'experimental', default: true },
  // 2026-11-03, stage 6: re-seed the oddest windows (judge), downgrade when that fails (docs/superpowers/specs/2026-11-03-stage6-judge-design.md)
  // 2026-11-04, v0.6.1: becomes the viewer's 整体修图 switch (global re-pack), off by default (NOTE D45)
  { id: 'exp-02', title: '整体修图：评判器挑出最不像参考图的主街区打包', status: 'experimental', default: false },
];

export const DEFAULT_OPTIONS: GenOptions = { novelty: 0.1, experiments: true, exp: {}, prune: true, pruneDraft: false, prefs: true };

/** stage 7: a `fire` for experiments registered later: base chance at novelty 0, always at novelty 1 */
export const fireByNovelty = (base: number) => (n: number) => base + n * (1 - base);

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
