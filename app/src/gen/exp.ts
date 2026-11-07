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
  /** version it was adopted in; regenerating an older version (options.asOf) treats it as experimental, with the
   *  `default` it had then */
  adoptedIn?: string;
  /** version it was registered in; regenerating an older version (options.asOf) runs without it */
  addedIn?: string;
  fire?: (novelty: number) => number;
}

/** stage 7: a `fire` for experiments registered later: base chance at novelty 0, always at novelty 1 */
export const fireByNovelty = (base: number) => (n: number) => base + n * (1 - base);

export const EXPERIMENTS: Experiment[] = [
  // 2026-11-03, user label 684358 L3 + v0.5.0 question 2: AC units belong on flat roofs, not on the ground
  // 2026-11-04: adopted (user); keeps its own stream exp/exp-01, so the units are the ones it placed when switched on
  { id: 'exp-01', title: '平顶屋顶上的空调外机', status: 'adopted', default: true, adoptedIn: '0.7.1' },
  // 2026-11-03, stage 6: re-seed the oddest windows (judge), downgrade when that fails (docs/superpowers/specs/2026-11-03-stage6-judge-design.md)
  // 2026-11-04, v0.6.1: becomes the viewer's 整体修图 switch (global re-pack), off by default (NOTE D45)
  { id: 'exp-02', title: '整体修图：评判器挑出最不像参考图的主街区打包', status: 'experimental', default: false },
  // 2026-11-04: back rows packed tight against the front row hide behind its upper floors; slide them to the north end
  // 2026-11-04: adopted the same day (user): always on, no chance draw (NOTE D52); before 0.7.1 it did not exist (off)
  { id: 'exp-03', title: '前后排拉开：后排的楼推到最北', status: 'adopted', default: false, adoptedIn: '0.7.1' },
  // 2026-11-05: few building looks; the packs draw seamless / linked replacement strips. Composite buildings (terrace
  // sections, condo bays, terraced rows) and neighbours that touch switch to their linked state (terrace.ts)
  // no `fire`: when on, touching neighbours always link; each composite occasion fires with compositeChance(novelty)
  // 2026-11-06: adopted (user): always on (NOTE D54); keeps its own stream exp/exp-04 and compositeChance, so the picture
  // is the one it made when switched on
  { id: 'exp-04', title: '拼接楼：多段拼成的楼，相邻的楼自动换成链接版', status: 'adopted', default: true, addedIn: '0.7.2', adoptedIn: '0.7.2' },
  // 2026-11-06: the user: the packs' other composable buildings into the random mix too (scope: the five street kits,
  // Condo_3 / Condo_4 / Condo_7 / office / hotel; not hospital, school corridor, greenhouse, hangar). kits.ts
  // no `fire`, like exp-04: each building the packer picks gives way to a kit building with kitChance(novelty)
  // 2026-11-07: adopted (user): always on, still tied to novelty, twice the chance it had (kitChance); keeps its stream
  { id: 'exp-05', title: '其余拼接楼：Condo_3 / Condo_4 / Condo_7、办公楼、酒店', status: 'adopted', default: false, addedIn: '0.7.3', adoptedIn: '0.7.5' },
  // 2026-11-07, user (seed 716771, novelty 0.7 + exp-05): one yard space cut into two touching rectangles became two
  // gardens with paths a row apart. Gardens touching or up to 2 cells apart become one garden, their paths linked
  // (yard.ts joinGardens); the same day the user: gardens a column apart too (161781)
  // no `fire`: a fix, it runs whenever two gardens are neighbours
  // 2026-11-07: adopted (user): always on
  { id: 'exp-06', title: '相邻的花园合成一个：小路连通', status: 'adopted', default: false, addedIn: '0.7.4', adoptedIn: '0.7.5' },
  // 2026-11-07, user labels 464294 L1 (a garden path from wall to wall), 271666 (an alley ending on the grass, its bin
  // in the way): a dead-end path or alley is first continued a few cells to somewhere walkable, else turned into lawn.
  // A repair after generation (constraint C25, rational/constraints.ts), no random numbers; on unless switched off
  { id: 'exp-07', title: '断头路：先接上，接不上就删', status: 'experimental', default: true, addedIn: '0.7.5' },
];

/** exp-04 (adopted): chance per occasion (a floor-modular building that may grow into a terrace, a condo / house that may be
 *  put together from parts) */
export const compositeChance = fireByNovelty(0.35);

/** exp-05 (adopted): chance that a picked residential building becomes a kit building (a shop: half of it), see pack.ts
 *  kitSwap. Since 0.7.5 twice the experiment's fireByNovelty(0.2), capped at 1 (user: 出现概率翻倍) */
export const kitChance = (n: number, o?: GenOptions) => Math.min(1, (o && !since(o, '0.7.5') ? 1 : 2) * fireByNovelty(0.2)(n));

export const DEFAULT_OPTIONS: GenOptions = { novelty: 0.1, experiments: true, exp: {}, prune: true, pruneDraft: false, prefs: true };

export function withDefaults(o: Partial<GenOptions> = {}): GenOptions {
  return { ...DEFAULT_OPTIONS, ...o, exp: { ...DEFAULT_OPTIONS.exp, ...(o.exp ?? {}) } };
}

/** a < b for versions like 0.7.1 */
const older = (a: string, b: string) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0); return false; };

/** does a scene made with options `o` include what changed in version v (options.asOf: regenerating an older version) */
export const since = (o: GenOptions, v: string) => !(o.asOf && older(o.asOf, v));

/** switch state (master switch + per-feature switch), independent of chance */
export function expEnabled(o: GenOptions, id: string): boolean {
  const e = EXPERIMENTS.find(x => x.id === id);
  if (!e || e.status === 'retired') return false;
  if (o.asOf && e.addedIn && older(o.asOf, e.addedIn)) return false;
  if (e.status === 'adopted' && !(o.asOf && e.adoptedIn && older(o.asOf, e.adoptedIn))) return true;
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
