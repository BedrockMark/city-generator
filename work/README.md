# work/

Gitignored scratch (`work/*`, only this README is tracked). Everything here is produced by the Python pipeline in
[`tools/`](../tools/README.md) or the scripts in [`app/scripts/`](../app/README.md), or is one-off session debris.
A fresh clone starts with an empty `work/`; recreate what you need with the commands below. `tools/common.py` defines
`WORK = ROOT/'work'` and `REFS = WORK/'refs'`.

## Subfolders and files

| Path | Produced by | Purpose |
|---|---|---|
| `refs_raw/<name>.png` | `tools/extract_frames.py` | Frame 0 of each reference GIF/PNG as RGBA (needs the maps in `references/`). |
| `refs/<name>.png` | `tools/normalize_refs.py` | Reference maps at native 1x pixels; every other analysis script reads these. |
| `maps/<name>.png` | `tools/crop_maps.py` | ROI crop of each reference for eyeballing. |
| `tile_index.npz`, `tile_index.json` | `tools/build_tile_index.py` | Every 16x16 cell of every combined sheet in `assets/`, deduplicated. |
| `catalog.json`, `catalog.csv` | `tools/build_catalog.py` | Every Singles sprite with pack, name, size, opaque bbox, `dup_of`; input of `export_manifest.py`, `export_links.py`, `export_refworld.py`. |
| `autotile.json` | `tools/autotile.py` | 47-blob autotile table from the GMS sheet; copied to `app/src/gen/data/autotile.json`. |
| `grid.json` | `tools/grid_align.py` | 16 px grid phase per reference. |
| `sprite_tiles.json` | `tools/grid_objects.py` | Cache of sprite-to-tile matches. |
| `grid/<name>.json`, `_bg.png`, `_objects.json` | `tools/grid_layer.py`, `tools/grid_objects.py` | Tile-layer model and grid-placed sprites per reference. |
| `detect/<name>.json`, `_overlay.png`, `_residual.png` | `tools/detect_objects.py` | Free-placed sprite detections per reference. |
| `scenes/<name>.json`, `_recon.png`, `_diff.png` | `tools/scene.py` | References in the common scene format plus reconstruction check. |
| `stats/stats.json`, `stats/summary.md` | `tools/stats.py` | Aggregate statistics over the references. |
| `characters/` | `tools/characters.py`, `detect_characters.py`, `char_stats.py` | Character layer catalog, contact sheets, detections, `people.json`. |
| `refworld/<name>.json` | `tools/export_refworld.py` | The 21 street references as "world" JSON for `npx tsx scripts/constraints.ts refs` and `tools/export_usage.py`. |
| `gen/scene_<seed>.json`, `scene_<district>_<seed>.json` | `app/scripts/batch.ts` | Headless generated scenes; `tools/render_generated.py` writes `scene_<seed>.png` next to them, `tools/eval_generated.py` scores them. |
| `regress/<name>/` | `app/scripts/regress.ts snapshot[-par]` | Regression baseline: `<seed>.json` (visual signature), `<seed>.audit.json`, `<seed>.learn.json` for the 200 seeds in `app/scripts/regression_seeds.json` (601 files). Current default baseline name: `v0791`. |
| `regress/*.txt`, `regress/*.log` | `regress.ts report` (redirected by hand) | Saved reports and run logs. |
| `shots/`, `shots04/`, `shots05*/`, `shots06/`, `shots061/`, `shots_v076/`, `t10_shots/` | `app/scripts/shots.ts` | Viewer screenshots and exports: `citygen_v<ver>_seed<N>[_d<district>].png/.json/_ghost.png/_annotated.png`, `ui_seed<N>.png`. Per-version report sets. |
| `readme_shots/`, `readme_shots/<district>/` | `app/scripts/shots.ts` | Input of `tools/make_readme_figs.py`, which writes the tracked `docs/readme/*.png`. |
| `readme_preview/`, `readme_check/` | by hand | Scratch while checking README figures. |
| `gaps/gaps.json`, `gaps.md`, `scenes/`, `seed<N>_L<k>.png` | `app/scripts/prefs.ts gaps`, `tools/crop_region.py` | Bad labels that the A/B choices cannot explain, with crops. |
| `readme_inventory.json`, `readme_facts.txt`, `_*_inv.*` | by hand | Notes used to write the folder READMEs. |
| `ab_smoke/`, `adopt09/`, `dbg716771/`, `deadend/`, `edits/`, `exp04/`, `exp05/`, `ffix/`, `judge/`, `labelcheck/`, `repair06/`, `review7/`, `special/`, `spread/`, `t8_smoke/`, `t10_warm/`, `v03/`, `v076tree/`, `v078/`, `v079/`, `tools_empty_git_backup/` | legacy | Ad-hoc per-session debugging folders (temporary `.mts`/`.py` scripts, before/after dumps, a copy of the app tree at v0.7.6). No command regenerates them; safe to delete. Only `deadend/` is read by `tools/deadend_pairs.py`. |
| loose `p_*.py`, `*.mts`, `*.log`, `*.txt`, `*.png`, `ed.py`, `d62.md` | legacy | One-off session scripts and pictures; safe to delete. |

## Commands

| Working dir | Command | Produces |
|---|---|---|
| `tools` | `sh run_analysis.sh` | `refs_raw/`, `refs/`, `tile_index.*`, `catalog.*`, `maps/`, `grid/`, `detect/` (needs `assets/` and the reference maps). |
| `tools` | `uv run python export_refworld.py && uv run python export_usage.py` | `refworld/<name>.json`, then `app/src/gen/data/usage.json`. |
| `app` | `npx tsx scripts/batch.ts ../work/gen 1..12 [--d=gas]` | `gen/scene_<seed>.json` for seeds 1..12 (`--d=` also takes `school`, `hospital`, `palace`). |
| `tools` | `uv run python render_generated.py ../work/gen/scene_1.json --scale 1 [--ghost]` | `gen/scene_1.png` next to the JSON. |
| `tools` | `uv run python eval_generated.py ../work/gen/scene_1.json --out report.md` | Evaluation of generated scenes against the references. |
| `app` | `npx tsx scripts/regress.ts snapshot-par ../work/regress/<name> --jobs 8` | A baseline of 200 seeds (about 40 s). |
| `app` | `npx tsx scripts/regress.ts compare ../work/regress/<A> ../work/regress/<B>` | Seeds whose picture changed; `report` adds constraint audits and label tests. |
| `app` | `npx tsx scripts/shots.ts ../work/readme_shots --anno --q=d=none 7 2 13` | Viewer screenshots (vite on :5173 and Edge required); then `cd tools && uv run python make_readme_figs.py` builds `docs/readme/*.png`. |
| `app` | `npx tsx scripts/prefs.ts gaps` | `gaps/`. |

## Notes

- Nothing in `work/` is in git. Regression baselines in `regress/` must be re-snapshotted on a fresh clone: check out the
  matching tag, run `regress.ts snapshot-par`, then come back and snapshot the current tree to compare.
- `tools/export_manifest.py` requires `catalog.json`, so `build_catalog.py` (or `run_analysis.sh`) must run before the
  asset metadata in `app/src/gen/data/` can be regenerated.
- `run_analysis.sh` stops after `detect_objects.py`; `scene.py`, `stats.py`, `characters.py` and `export_refworld.py` are
  run separately.
- `render_generated.py` overwrites same-named PNGs beside the scene JSON.
- `refs/`, `grid/`, `detect/` and `scenes/` may still hold stale `ANTI_site_overview.*` outputs from a reference that was
  removed from `tools/refs_meta.json`; `ref_names()` no longer lists it.
- `regress/` holds many undocumented directories (`t1`..`t9*`, `fx-n0l0`, `exp03-*`, `v0.6.1-*`, `v076-commit`) besides
  the baselines named in `docs/PROGRESS.md`; they are all disposable.
