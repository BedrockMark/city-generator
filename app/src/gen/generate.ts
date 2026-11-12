// Top-level generator: seed -> Scene.
import { Rng, Trace } from './rng';
import { makeLayout, cloneLayout, type Layout } from './layout';
import { planMainBlock, emitBuildings, type BlockPlan } from './block';
import { planNeighbours } from './neighbours';
import { SceneBuilder } from './place';
import { resetIds } from './buildings';
import { explainGround } from './explain';
import { curbRuns, reserveWalkways, crossingVignettes, curbStrips, frontVignettes, zoneVignettes, islandSquares, busStop, cars, roadDetails, walkers } from './vignettes';
import { yardSpaces } from './yard';
import { SHEETS, TILE, type Scene, type GenOptions } from './types';
import { withDefaults, expStream, compositeChance, kitChance } from './exp';
import { linkBuildings, EXP04 } from './terrace';
import { EXP05, resetKitIds } from './kits';
import { rooftopAC } from './rooftop';
import { rationalize } from './rational/rationalize';
import { makeAdjust } from './learn/adjust';
import { PREFS } from './learn/prefs';
import { markNovel } from './learn/novelty';
import { planCampus, districtVignettes, isDistrict, resetDistrictIds } from './district';

export const VERSION = '0.8.0-hotfix1';

export function generate(seed: string, options: Partial<GenOptions> = {}): Scene {
  return generateBase(seed, withDefaults(options));
}

/** a world block's window (city mode, spec 4): the layout in window coordinates, built by the world layer */
export interface BlockWindow {
  layout: Layout;
  /** merged into scene.params (world: { seed, blockId, zone, offset }) */
  params: Record<string, unknown>;
}

/** the generator proper, constraint repairs included (stage 5). With `win`: the window's layout instead of makeLayout,
 *  no neighbour blocks planned (they are generated on their own), no 'nfronts' / 'island' subsystems; every stream is
 *  forked by label from the seed, so skipping these leaves the others' draws unchanged */
export function generateBase(seed: string, opts: GenOptions, win?: BlockWindow): Scene {
  resetIds();
  resetKitIds();
  resetDistrictIds();
  // stage 7: learned preferences (and novelty) reweight decisions; undefined = every draw is the old one
  const trace = new Trace(seed, makeAdjust(opts, PREFS));
  const rng = new Rng(seed, trace);
  // exp-08 (adopted): a special district's campus, planned first: the block is sized to it. Always the caller's choice
  // (0.7.8.2): no option = 普通街区, never drawn here (the viewer's random mix is src/viewer/mix.ts)
  if (opts.district !== undefined && !isDistrict(opts.district)) throw new Error(`unknown district: ${String(opts.district)}`);
  const district = opts.district;
  const campus = district && planCampus(district, rng);
  const L = win ? cloneLayout(win.layout) : makeLayout(rng, campus && { w: campus.W, h: campus.H });
  const sb = new SceneBuilder(L.cols, L.rows, L.cls);
  // exp-04 (adopted): composite buildings on its own stream; touching neighbours switch to their linked state (no random numbers)
  const composite = { r: expStream(rng, EXP04, opts.novelty), p: compositeChance(opts.novelty) };
  // exp-05 (adopted): the packs' other building kits in place of a picked building, on its own stream
  const kits = { r: expStream(rng, EXP05, opts.novelty), p: kitChance(opts.novelty) };
  const main = planMainBlock(L, rng, composite, kits, campus);
  const neigh: BlockPlan = win ? { buildings: [], zones: [], yard: L.cls.map(row => row.map(() => false)), yb: new Map(), yt: new Map() }
    : planNeighbours(L, rng, composite, kits);
  linkBuildings([main, neigh]);
  sb.inStream('block', () => emitBuildings(L, main, sb, 'main'));
  sb.inStream('neigh', () => emitBuildings(L, neigh, sb, 'neigh'));
  // exp-01 (adopted): AC units on flat roofs
  const e01 = expStream(rng, 'exp-01', opts.novelty);
  sb.inStream(e01.stream, () => rooftopAC([main, neigh], sb, e01));
  // yard spaces first: parking driveways cut the curb, which changes the curb runs
  // each subsystem runs on its own stream; sb records which stream placed what (label attribution, stage 7)
  const on = (label: string, fn: (r: Rng) => void) => { const r = rng.fork(label); sb.inStream(r.stream, () => fn(r)); };
  // exp-06 (adopted): touching gardens share one path (decided on its own stream)
  const e06 = expStream(rng, 'exp-06', opts.novelty);
  on('yard', r => yardSpaces(L, main, sb, r, e06));
  // exp-08: the campus grounds (driveways cut the curb, so before the curb runs)
  const lm = main.landmark;
  if (lm) on('district', r => districtVignettes(L, lm, sb, r));
  const runs = curbRuns(L);
  reserveWalkways(sb, runs);
  // city mode: only the block's own curb runs get furniture, cars, walkers (the neighbours' runs belong to their own
  // windows), so the draws do not depend on how much of the neighbours the window shows
  const own = win ? runs.filter(u => u.main) : runs;
  // order = priority: things with a strong reason claim their space first
  on('cross', r => crossingVignettes(L, sb, r));
  on('zones', r => zoneVignettes(L, main, sb, r));
  on('bus', r => busStop(L, sb, r, own));
  on('fronts', r => frontVignettes(L, main, sb, r));
  if (!win) {
    on('nfronts', r => frontVignettes(L, { ...neigh, buildings: neigh.buildings.filter(b => b.side === 'S') }, sb, r));
    on('island', r => islandSquares(L, neigh, sb, r));
  }
  on('curb', r => curbStrips(L, sb, r, own));
  on('cars', r => cars(L, sb, r, own));
  on('road', r => roadDetails(L, sb, r));
  on('walk', r => walkers(L, sb, r, own));
  explainGround(L, sb, runs);
  sb.finish();
  // the window's params sit beside the generator's, never over them
  const clash = win && Object.keys(win.params).find(k => ['district', 'shape', 'interior', 'roads', 'sidewalk', 'buildings'].includes(k));
  if (clash) throw new Error(`window params override the generator's: ${clash}`);
  const scene: Scene = {
    version: VERSION, seed,
    params: { ...(district ? { district } : {}), shape: L.shape, interior: [L.bx1 - L.bx0, L.by1 - L.by0], roads: { h: L.rH, v: L.rV }, sidewalk: L.sw,
      buildings: main.buildings.map(b => b.plan.label), ...win?.params },
    cols: L.cols, rows: L.rows, tile: TILE, sheets: SHEETS,
    ground: [L.base, L.over], objects: sb.objects, cells: L.cls, notes: [],
    options: opts, groups: [...sb.groups.values()], buildings: sb.buildings, zones: sb.zones, trace: trace.toJSON(),
  };
  // stage 7: objects drawn from a never-used sprite (novelty); before the audit, which may delete some of them
  markNovel(scene, trace.novel);
  // stage 5: constraint audit; repairs by deletion with the confirmed constraints, dead ends continued or removed
  // (C25, exp-07 adopted); no random numbers used
  scene.audit = rationalize(scene, opts);
  return scene;
}
