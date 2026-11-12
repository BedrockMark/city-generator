# app/src/world/

The world layer of city mode (v0.8.0, spec `docs/superpowers/specs/2026-11-11-v1-city-design.md`): zones, arterial roads, street cuts into blocks, per-cell classes and ownership, world ground, block windows that run the single-block generator from [`../gen/`](../gen/README.md), and region assembly. Every function is a pure function of `(seed, world cell coordinates)`: random choices are coordinate hashes, so any part of the world can be computed alone and in any order (NOTE D73). Cells are integers, may be negative, 1 cell = 16 px; rects are half-open. `world/` imports from `gen/`, never the other way round. Single-block mode (`generate(seed)`) does not use this folder.

## Files

| Path | Purpose |
|---|---|
| `config.ts` | Every world tunable as a named constant (spec 3.8): arterial spacing / jitter / widths (11 / 17: two or three lanes each way, every line on its own cell) / lane width / jog, street width, jog chance / step / position / gap, zone thresholds and per-zone lot ranges, sidewalk width and paving, crossing chances, window margin, pads, `CITY_NOVELTY`, caches. `ROAD_WIDTHS` and `REGION_PAD` are derived. No other file holds these numbers |
| `types.ts` | `Rect`, `ZoneKind`, `BlockRec` (id, cell, footprint rects, sw, zone, paving, shape, why), `WorldCell`, `WCrossing` |
| `hash.ts` | Coordinate hash `hash01` / `hashInt` / `hashPick(seed, ...keys)` (cyrb128, as in `gen/rng.ts`) |
| `zone.ts` | `zoneValue` (two-layer smoothstep value noise on the arterial lattice) and `zoneAt` (downtown / mixed / residential) |
| `arterials.ts` | `vLine` / `hLine` (band of an arterial segment, with jitter, width and per-segment jog), `cellRect`, `cellAt`, `arterialWhy` |
| `blocks.ts` | `cellBlocks(seed, i, j)`: recursive street cuts of one arterial cell into blocks (rect or jog), ids `b<i>,<j>/<path>`, cached; `blockAt`, `blockById`, `lotOf` |
| `cells.ts` | `worldCell`, `classRaster`, `blockRaster`, `cellRange`; road ownership (`roadOwner`, `ownerOf`, `ownerRaster`: nearest sidewalk by Chebyshev distance, smallest id on ties); `crossingsIn` (zebra per junction arm; a junction needs a real cross road, so a jog's widening is none) |
| `ground.ts` | `paintGround(seed, r)`: asphalt, autotiled sidewalk / lot paving, lane lines (streets: one dashed centre line; arterials: double solid centre line on `over` plus dashed lane lines), zebras; same tile pickers as `gen/layout.ts`, identical on overlapping rects |
| `window.ts` | `blockLayout` (a block plus `WINDOW_MARGIN` cells, top-left snapped to `SLAB_PERIOD`, as a gen `Layout`, with `topLimit` at the north road centre line, `org` = world origin for stream labels, road segments cut to the block's own stretches and only the crossings it touches, so the block does not depend on the margin), `generateInWindow` (runs `generateBase` with the window, then drops objects / zones on cells the block does not own), `generateBlock` (cached by `BLOCK_CACHE`), `ownerCell`, `zoneCell`, `CityOptions` |
| `region.ts` | `blocksIn(seed, r)` and `assembleRegion(seed, r)`: one `Scene` for a world rect (world ground + each owner block's ground edits, objects / buildings / groups / zones with `<blockId>:` prefixes, `params.world`) |
| `*.test.ts` | node:test suites (47 tests, run by `npm test`): hash, zone continuity and shares, arterial coverage without gaps, cuts in range over 30 seeds x 7 x 7 cells and jog ratio, ownership, crossings, ground seams, window ownership / determinism / cache independence / height limit, region halves vs whole and order independence. All include negative coordinates |

## Usage

`cd app && npx tsx scripts/cityshot.ts ../work/city080 <seed> [x0,y0,w,h]` writes `city_<seed>.json` for a world rect (default `-60,-44,360,264`, about 45 s) and prints block size, zone, jog and violation statistics; render it with `cd tools && uv run python render_generated.py ../work/city080/city_1.json --scale 1`.
