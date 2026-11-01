// Top-level generator: seed -> Scene.
import { Rng } from './rng';
import { makeLayout } from './layout';
import { planMainBlock, emitBuildings } from './block';
import { planNeighbours } from './neighbours';
import { SceneBuilder } from './place';
import { resetIds } from './buildings';
import { curbRuns, reserveWalkways, crossingVignettes, curbStrips, frontVignettes, zoneVignettes, islandSquares, busStop, cars, roadDetails, walkers } from './vignettes';
import { yardSpaces } from './yard';
import { SHEETS, TILE, type Scene } from './types';

export const VERSION = '0.3.0';

export function generate(seed: string): Scene {
  resetIds();
  const rng = new Rng(seed);
  const L = makeLayout(rng);
  const sb = new SceneBuilder(L.cols, L.rows, L.cls);
  const main = planMainBlock(L, rng);
  const neigh = planNeighbours(L, rng);
  emitBuildings(L, main, sb);
  emitBuildings(L, neigh, sb);
  // yard spaces first: parking driveways cut the curb, which changes the curb runs
  yardSpaces(L, main, sb, rng.fork('yard'));
  const runs = curbRuns(L);
  reserveWalkways(sb, runs);
  // order = priority: things with a strong reason claim their space first
  crossingVignettes(L, sb, rng.fork('cross'));
  zoneVignettes(L, main, sb, rng.fork('zones'));
  busStop(L, sb, rng.fork('bus'), runs);
  frontVignettes(L, main, sb, rng.fork('fronts'));
  frontVignettes(L, { ...neigh, buildings: neigh.buildings.filter(b => b.side === 'S') }, sb, rng.fork('nfronts'));
  islandSquares(L, neigh, sb, rng.fork('island'));
  curbStrips(L, sb, rng.fork('curb'), runs);
  cars(L, sb, rng.fork('cars'), runs);
  roadDetails(L, sb, rng.fork('road'));
  walkers(L, sb, rng.fork('walk'), runs);
  return {
    version: VERSION, seed,
    params: { shape: L.shape, interior: [L.bx1 - L.bx0, L.by1 - L.by0], roads: { h: L.rH, v: L.rV }, sidewalk: L.sw,
      buildings: main.buildings.map(b => b.plan.label) },
    cols: L.cols, rows: L.rows, tile: TILE, sheets: SHEETS,
    ground: [L.base, L.over], objects: sb.objects, cells: L.cls, notes: [],
  };
}
