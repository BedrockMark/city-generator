# app/src/gen/

The generator proper: pure TypeScript, no Phaser. `generate(seed, options?)` turns a seed string into a `Scene` JSON (ground tiles, placed sprites, buildings, groups and zones with reasons, a decision trace and a constraint audit). It is consumed by the Phaser viewer (`../main.ts`, `../viewer/`), by the Node scripts in `../../scripts/` (batch, regress, prefs, constraints, shots) and, once exported, by the Python tools in `../../../tools/`. `data/` is JSON exported from the asset packs by those tools, `rational/` is the constraint audit and repair, `learn/` is the learned-preference and novelty reweighting. Tests are `node:test` files next to the code they test. Current `VERSION` is `0.8.0`. City mode (`../world/`) calls `generateBase` with an optional block window; without it nothing changes.

## Pipeline (`generate.ts` -> `generateBase`)

1. `resetIds` / `resetKitIds` / `resetDistrictIds`; `Trace` + root `Rng(seed)` with the `makeAdjust(opts, PREFS)` hook (learned preferences x novelty).
2. `planCampus(district, rng)` if `opts.district` is set (the block is sized to the campus; an unknown district throws).
3. `makeLayout` : block interior, sidewalk ring, road band, neighbour regions, autotiled ground, lane markings, crossings.
4. `planMainBlock` + `planNeighbours` (packer in `pack.ts`; composite buildings on stream `exp/exp-04`, kit buildings on `exp/exp-05`).
5. `linkBuildings` : touching buildings swap to their seamless `_Modular` edge pieces (no random numbers).
6. `emitBuildings` for `main` and `neigh`, then `rooftopAC` (stream `exp/exp-01`).
7. `yardSpaces` (stream `yard`, gardens merged on `exp/exp-06`), then `districtVignettes` (stream `district`) : both may cut driveways into the curb.
8. `curbRuns` + `reserveWalkways`, then the street vignettes in priority order, one stream each: `cross`, `zones`, `bus`, `fronts`, `nfronts`, `island`, `curb`, `cars`, `road`, `walk`.
9. `explainGround` (road segments and crossings become zones), `sb.finish()`, assemble the `Scene`.
10. `markNovel` (objects drawn from never-used sprites), then `rationalize` writes `scene.audit` (constraint audit, repair by deletion; no random numbers).

RNG forking: `rng.fork(label)` seeds a new sfc32 stream from the original seed plus the label (`seed/label`, nested as `fronts/b7`), so adding or removing draws in one subsystem does not reshuffle the others. The stream name is part of the seed, so renaming any stream (`yard`, `cross`, `exp/exp-04`, `district/palace`, ...) changes every picture for every seed and invalidates regression baselines. In city mode (a world window, `Layout.org` set) labels that hold coordinates add the window's world origin (`orgOf`), crossings get one stream each (`cross/xing…`), and only the block's own curb runs reach `bus` / `curb` / `cars` / `walk`, so a block's content does not depend on its window (NOTE D82); single-block labels are unchanged.

## Files

| Path | Purpose |
|---|---|
| `generate.ts` | Entry point: `generate`, `generateBase(seed, opts, win?)` (optional `BlockWindow` from `../world/window.ts`: its layout replaces `makeLayout`, no neighbours / `nfronts` / `island`), `VERSION`; wires the stages above |
| `types.ts` | Scene JSON format shared with the viewer and `tools/eval_generated.py`: `TILE` (16 px), `SHEETS`, `Placed`, `GroupRec`, `BuildingRec`, `ZoneRec`, `Scene`, `GenOptions` |
| `exp.ts` | `DEFAULT_OPTIONS` (novelty 0.1, prune, prefs), `withDefaults`, `expStream`, `fireByNovelty`, `compositeChance`, `kitChance`; remains of the experiment system |
| `rng.ts` | Seeded RNG (sfc32 + cyrb128), `fork`, decision `Trace`; labelled `choose / count / order / tex`, unlabelled `pick / weighted / chance / shuffle`, geometry `int / range / jitter` |
| `layout.ts` | `makeLayout(rng, need?)`: block geometry and ground; `autotile`, `slab`, `asphalt`, `paintWalkCell` |
| `buildings.ts` | Building factory: `modularStack`, `singleBuilding`, `pickBuilding`, `BuildingPlan`, id counters |
| `pack.ts` | Bottom-aligned building packer `pack(opts, rng)` for a region of cells; spread, kit swap, composite proposals |
| `block.ts` | `planMainBlock` (frontage, north row, alleys, plaza, courtyard, or a campus landmark) and `emitBuildings` |
| `neighbours.ts` | `planNeighbours`: surrounding blocks packed for context (may run off the edge) |
| `terrace.ts` | Composite buildings (`terraceSection`, `condoBays`, `terracedRow`) and deterministic `linkBuildings` via `data/links.json` |
| `kits.ts` | Kit buildings from the packs: `condo3`, `condo4Row`, `condo4Tower`, `condo7Row`, `office`, `hotel` |
| `district.ts` | Special districts: `DISTRICTS` table (school, hospital, police, fire, mall, hotel, gas, palace), `planCampus`, `placeCampus`, `districtVignettes`, `driveway` |
| `palace.ts` | Palace garden district (`palacePlan`, `palaceCampus`, `palaceGrounds`: pool, maze, playground, greenhouse, hedged rooms); menu-only, called from `district.ts` |
| `yard.ts` | `yardSpaces`: parking with driveways, gardens, forecourts, passages, green strips, service corners; `joinGardens`, `bestRect` |
| `vignettes.ts` | Street-level groups with reasons: `curbRuns`, `reserveWalkways`, `crossingVignettes`, `curbStrips`, `frontVignettes`, `zoneVignettes`, `islandSquares` / `islandSquare` (one island square; city mode's notch islands use it too), `putClearOfDoors` / `hidesDoor` (C24 at placement: plaza centre pieces, garden trees), `busStop`, `cars`, `roadDetails`, `walkers`, `person` |
| `rooftop.ts` | `rooftopAC`: AC units on modular flat roofs, drawn right after their building |
| `people.ts` | Character composition `makePerson` (body, eyes, outfit, hair, accessory) and `frameFor` |
| `place.ts` | `SceneBuilder`: placement by feet, footprint occupancy, keep-clear zones, `group()` / zones with reasons, `inStream()` attribution, `withExp()`, `finish()`; `rect`, `overlaps` |
| `explain.ts` | `explainGround`: carriageway segments and crossings as zones so the annotation layer can explain empty road |
| `assets.ts` | Typed access to `data/*.json`: `spr`, `hasSprite`, `variants`, `MODULAR`, `AUTOTILE`, `CHARS` |
| `boxes.ts` | `objBox` (pixel box of an object) and `hiddenObjects` (objects drawn over by a building) |
| `signature.ts` | `signature(scene)`: exactly what renderers draw, ignoring explanation fields; used by `scripts/regress.ts` |

### `data/` (generated, imported at build time)

| Path | Purpose | Regenerate with |
|---|---|---|
| `data/sprites.json` | Sprite manifest key -> [png path, w, h, bx0, by0, bx1, by1] (opaque bounding box) for `assets.ts spr()` | `cd tools && uv run python export_manifest.py` |
| `data/modular.json` | Modular building pieces by family (key, colour, h, variant) for `modularStack` | `export_manifest.py` |
| `data/characters.json` | Character layer catalog `{layers, themes}` (body, eyes, outfit, hair, accessory sheets plus theme tags from `tools/character_themes.json`) for `people.ts` | `export_manifest.py` |
| `data/autotile.json` | 47-blob autotile tables (style -> {row0, masks: mask -> [col,row]}) for `layout.ts autotile()` | `tools/autotile.py` into `work/`, then copied by `export_manifest.py` |
| `data/opaque.json` | Per-sprite opaque-pixel bitmasks for occlusion / hidden-object detection | `cd tools && uv run python export_opaque.py` |
| `data/links.json` | Each `5_Floor_Modular` piece -> its L / R `_Modular` edge replacement for `linkBuildings` | `cd tools && uv run python export_links.py` |
| `data/usage.json` | Sprite usage counts from the reference maps (502 keys) for `learn/novelty.ts` | `cd tools && uv run python export_usage.py` |
| `data/prefs.json` | Trained Bradley-Terry preference multipliers (version 0.7.0, 2 labels) for `learn/prefs.ts` | `cd app && npx tsx scripts/prefs.ts train` |

### `learn/` (stage 7: reweighting decisions)

| Path | Purpose |
|---|---|
| `learn/adjust.ts` | `makeAdjust(opts, prefs)`: the `Trace.adjust` hook = preference multipliers x novelty factor |
| `learn/prefs.ts` | Bradley-Terry model per decision label: `fit`, `score`, `toTable`, `multiplier` (clamped to [0.2, 5]), `filterBlacklist`; loaded `PREFS` |
| `learn/novelty.ts` | `rarity`, `noveltyFactors` (1 + novelty x BETA x rarity), `markNovel` |
| `learn/data.ts` | Node-only: turns A/B choice files and good/bad labels into `Comparison`s for training |
| `learn/labels.ts` | Node-only: reads `references/labels/v<version>/` (`LABEL_DIR`, `verGE`, `labelRegion`) |
| `learn/blacklist.json` | Hand-maintained list of preference labels / `label|option` entries rejected before retraining; currently empty |

### `rational/` (stage 5: constraint audit and repair)

| Path | Purpose |
|---|---|
| `rational/world.ts` | Neutral `World` view: `worldFromScene`, `worldFromRef` (from `tools/export_refworld.py`); `inRect`, `rectsOverlap`, `rectGap`, `grow` |
| `rational/graph.ts` | `buildGraph`: walkable ground rasterised at 4 px into components and purposeful places rooted at street / edge / door |
| `rational/constraints.ts` | Declarative `CONSTRAINTS` C01..C25 (all active; fixes: remove, downgrade, report) plus `evaluate`, `subjects`, `selects`; C25 is the dead-end path logic |
| `rational/rationalize.ts` | `rationalize(scene, opts)`: evaluates constraints, deletes / downgrades offenders, cascades through anchors, returns the `Audit` |

### Tests (`node:test`, run by `npm test`)

| Path | Covers |
|---|---|
| `window.test.ts` (5) | `generateBase` with a block window; packer `topLimit` (city mode height limit) |
| `rng.test.ts` (9) | Fork independence, decision trace, adjust hook |
| `deadend.test.ts` (8) | C25 dead-end paths on two fixture scenes from `references/labels/v0.7.4/` (tracked JSON) |
| `district.test.ts` (3), `palace.test.ts` (2) | Special districts and the palace garden; `palace.test.ts` imports `../viewer/mix.ts` |
| `kits.test.ts` (3), `terrace.test.ts` (5), `yard.test.ts` (5), `block.test.ts` (1) | Kit buildings, composite buildings and links, yard allocation, main block plan |
| `learn/prefs.test.ts` (8), `learn/novelty.test.ts` (5), `learn/data.test.ts` (4) | Bradley-Terry fit, novelty factors, comparison extraction |

## Commands

| Working dir | Command | Produces |
|---|---|---|
| `app` | `npm test` | Runs all `node:test` suites via `tsx --test` (104 tests incl. `src/viewer/mix.test.ts` and `src/world/*.test.ts`, about 1 min) |
| `app` | `npx tsc --noEmit` | Type-checks generator and viewer (about 3 s) |
| `app` | `npx tsx scripts/batch.ts ../work/gen 1..12 [--d=gas]` | Scene JSON per seed under `work/gen/` (optionally a special district) |
| `app` | `npx tsx scripts/regress.ts snapshot-par ../work/regress/<name> --jobs 8` then `compare <dirA> <dirB>` | 200-seed picture signatures and a diff of what changed |
| `app` | `npx tsx scripts/prefs.ts train` | Retrains `data/prefs.json` from `references/choices/` and `references/labels/` |
| `app` | `npx tsx scripts/constraints.ts gen [n] \| refs \| doc [n]` | Constraint statistics on generated scenes / references; `doc` regenerates `docs/reports/CONSTRAINTS.md` (`refs` and `doc` need `work/refworld/` from `cd tools && uv run python export_refworld.py`) |
| `tools` | `uv run python export_manifest.py && uv run python export_opaque.py` | `data/sprites.json`, `modular.json`, `autotile.json`, `characters.json`, `opaque.json` (needs the tileset at `<repo>/assets/` plus the gitignored `work/catalog.json`, `work/autotile.json`, `work/characters/catalog.json` from `tools/build_catalog.py`, `tools/autotile.py`, `tools/characters.py catalog`) |
| `tools` | `uv run python export_links.py` / `uv run python export_usage.py` | `data/links.json` / `data/usage.json` (needs `work/catalog.json` / `work/refworld/` from `tools/export_refworld.py`) |

## Notes

- The generator never picks a district itself: `opts.district` is always the caller's choice (`undefined` = plain block, unknown string throws). The viewer's 20% random mix lives in `../viewer/mix.ts`; `palace` is `menuOnly` and excluded from it.
- Stream names seed the RNG (see Pipeline). Never rename a fork label or `exp/<id>` stream unless you intend to change every picture; re-snapshot the regression baseline afterwards.
- `rationalize()` and `linkBuildings()` consume no random numbers by design; adding a draw there silently changes seeds.
- Labelled decisions (`choose / count / order / tex`) are recorded in `scene.trace` and are what preferences and novelty reweight; `pick / weighted / chance / shuffle` are counted as unlabelled and the regression report expects 0 of them.
- All experiments exp-01 and exp-03..exp-09 are adopted and untagged (exp-02 was removed). `SceneBuilder.withExp` still exists but nothing sets a `BuildingPlan.exp` today; `pruneDraft` is still an option but all 25 constraints are active, so it has no effect.
- `data/*.json` are committed; regenerating them needs the third-party tileset at `<repo>/assets/` (gitignored, provided separately), the `tools/` uv environment and the analysis artifacts under `work/` (gitignored): run the `tools/` pipeline first, see `../../../tools/README.md`.
- `learn/labels.ts` and `learn/data.ts` hard-code `references/labels` and `references/choices`; they are Node-only and not needed at generation time. The label and choice JSON are tracked, the reference images are not.
- Regression baselines (`work/regress/`) are gitignored: a fresh clone must take its own snapshot before comparing.
