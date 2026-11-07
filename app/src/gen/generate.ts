// Top-level generator: seed -> Scene.
import { Rng, Trace } from './rng';
import { makeLayout } from './layout';
import { planMainBlock, emitBuildings } from './block';
import { planNeighbours } from './neighbours';
import { SceneBuilder } from './place';
import { resetIds } from './buildings';
import { explainGround } from './explain';
import { curbRuns, reserveWalkways, crossingVignettes, curbStrips, frontVignettes, zoneVignettes, islandSquares, busStop, cars, roadDetails, walkers } from './vignettes';
import { yardSpaces } from './yard';
import { SHEETS, TILE, type Scene, type GenOptions } from './types';
import { withDefaults, expFires, expEnabled, compositeChance, kitChance } from './exp';
import { linkBuildings, EXP04 } from './terrace';
import { EXP05, resetKitIds } from './kits';
import { rooftopAC } from './rooftop';
import { rationalize } from './rational/rationalize';
import { alignScene } from './judge/align';
import { scoreWorld } from './judge/model';
import { judgeRepair, build, tagGlobal, EXP_ID } from './judge/repair';
import { makeAdjust } from './learn/adjust';
import { PREFS } from './learn/prefs';
import { markNovel } from './learn/novelty';

export const VERSION = '0.7.5';

export function generate(seed: string, options: Partial<GenOptions> = {}, onProgress?: (n: number, N: number) => void): Scene {
  const opts = withDefaults(options);
  // stage 6: a recorded judge repair (exported scene) is rebuilt as is
  if (opts.judgeFixed) {
    const sc = build(seed, opts, opts.reseed ?? {});
    if (opts.judgeFixed.global) tagGlobal(sc);
    return sc;
  }
  const scene = generateBase(seed, opts);
  // oddness of every window (read-only: the picture does not change)
  scene.judge = scoreWorld(alignScene(scene), undefined, opts.novelty);
  // exp-02: repair the oddest windows
  if (opts.judgeRepair !== false && expEnabled(opts, EXP_ID)) return judgeRepair(seed, opts, scene, onProgress);
  return scene;
}

/** the generator proper, constraint repairs included (stage 5); the judge and its repair come on top (stage 6) */
export function generateBase(seed: string, opts: GenOptions): Scene {
  resetIds();
  resetKitIds();
  // stage 7: learned preferences (and novelty) reweight decisions; undefined = every draw is the old one
  const trace = new Trace(seed, opts.reseed ?? {}, opts.force ?? {}, makeAdjust(opts, PREFS));
  const rng = new Rng(seed, trace);
  const L = makeLayout(rng);
  const sb = new SceneBuilder(L.cols, L.rows, L.cls);
  // exp-04: composite buildings on its own stream; touching neighbours switch to their linked state (no random numbers)
  const e04 = expFires(opts, EXP04, rng);
  const composite = e04 ? { r: e04, p: compositeChance(opts.novelty) } : undefined;
  // exp-05 (adopted 0.7.5): the packs' other building kits in place of a picked building, on its own stream
  const e05 = expFires(opts, EXP05, rng);
  const kits = e05 ? { r: e05, p: kitChance(opts.novelty, opts) } : undefined;
  const main = planMainBlock(L, rng, expEnabled(opts, 'exp-03'), composite, kits);
  const neigh = planNeighbours(L, rng, composite, kits);
  if (e04) linkBuildings([main, neigh]);
  sb.inStream('block', () => emitBuildings(L, main, sb, 'main'));
  sb.inStream('neigh', () => emitBuildings(L, neigh, sb, 'neigh'));
  const e01 = expFires(opts, 'exp-01', rng);
  if (e01) sb.inStream(e01.stream, () => rooftopAC([main, neigh], sb, e01));
  // yard spaces first: parking driveways cut the curb, which changes the curb runs
  // each subsystem runs on its own stream; sb records which stream placed what (stage 6 judge repair)
  const on = (label: string, fn: (r: Rng) => void) => { const r = rng.fork(label); sb.inStream(r.stream, () => fn(r)); };
  // exp-06 (adopted 0.7.5): touching gardens share one path (decided on its own stream)
  const e06 = expFires(opts, 'exp-06', rng);
  on('yard', r => yardSpaces(L, main, sb, r, e06));
  const runs = curbRuns(L);
  reserveWalkways(sb, runs);
  // order = priority: things with a strong reason claim their space first
  on('cross', r => crossingVignettes(L, sb, r));
  on('zones', r => zoneVignettes(L, main, sb, r));
  on('bus', r => busStop(L, sb, r, runs));
  on('fronts', r => frontVignettes(L, main, sb, r));
  on('nfronts', r => frontVignettes(L, { ...neigh, buildings: neigh.buildings.filter(b => b.side === 'S') }, sb, r));
  on('island', r => islandSquares(L, neigh, sb, r));
  on('curb', r => curbStrips(L, sb, r, runs));
  on('cars', r => cars(L, sb, r, runs));
  on('road', r => roadDetails(L, sb, r));
  on('walk', r => walkers(L, sb, r, runs));
  explainGround(L, sb, runs);
  sb.finish();
  const scene: Scene = {
    version: VERSION, seed,
    params: { shape: L.shape, interior: [L.bx1 - L.bx0, L.by1 - L.by0], roads: { h: L.rH, v: L.rV }, sidewalk: L.sw,
      buildings: main.buildings.map(b => b.plan.label) },
    cols: L.cols, rows: L.rows, tile: TILE, sheets: SHEETS,
    ground: [L.base, L.over], objects: sb.objects, cells: L.cls, notes: [],
    options: opts, groups: [...sb.groups.values()], buildings: sb.buildings, zones: sb.zones, trace: trace.toJSON(),
  };
  // stage 7: objects drawn from a never-used sprite (novelty); before the audit, which may delete some of them
  markNovel(scene, trace.novel);
  // stage 5: constraint audit; repairs by deletion with the confirmed constraints (no random numbers used)
  scene.audit = rationalize(scene, opts);
  return scene;
}
