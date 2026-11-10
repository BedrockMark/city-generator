# references/

The ground truth the generator is calibrated against: 46 hand-made reference maps (not published, see Notes) and the user's
feedback on generated scenes (good/bad labels and archived A/B choices, both tracked JSON). The maps are read by the Python
analysis pipeline in [`tools/`](../tools/README.md); the labels are written by the Phaser viewer in [`app/`](../app/README.md)
and read back by its regression and preference-training scripts.

## Contents

| Path | Purpose |
|---|---|
| `*.gif`, `*.png` | 46 reference maps (39 GIF, 7 PNG), 416x352 to 2444x1356 px, built pixel-exactly from the tileset in [`assets/`](../assets/README.md). Gitignored, not in the public repo. |
| `labels/` | The user's good/bad labels on generated scenes, one subfolder per generator version (`v0.4.0`, `v0.5.0`, `v0.5.1`, `v0.7.4`, `v0.7.5`; 35 label files, 72 labels). |
| `labels/v<ver>/seed<seed>.json` | Label file for one seed at one version: `{version, seed, labels: Label[]}` (fields below). Written by the viewer through the dev server. |
| `labels/v<ver>/<stem>.scene.json` | The full labelled Scene saved once per scene stem next to its labels, so later stages can read the labelled picture without regenerating. Single-line JSON, about 445 KB each. |
| `choices/` | Frozen archive of A/B answers from stage 7: `v0.7.0` (17 files) and `v0.7.1` (2 files), 77 answered changes. Legacy: the writer was removed in v0.7.6, no new files can be made. |
| `choices/v<ver>/seed<seed>_<YYYYMMDD-HHMMSS>.json` | One A/B session: `{version, seed, options, novelty, created, kind 'auto'\|'manual', changes[]}`; each change is `{stream, label, k, ctx?, a, b, rect, answer 'a'\|'b'\|'same', note?}`. |
| `README.md` | This file. |

## Reference maps

| Item | Detail |
|---|---|
| Metadata | `tools/refs_meta.json`: one entry per map (46) plus `_doc`. `kind` = `street` (21, block with road and sidewalk), `site` (19, single venue or nature), `showcase` (6, building or asset demo, not a map); `roi` = `[x0,y0,x1,y1]` native px of the map part or `null` (whole image minus the 4 px frame); `group` = near-duplicate family (8 maps). |
| GIF frames | Only frame 0 is used. Most GIFs have 24 frames (animation of water, people and so on). |
| Pipeline | `tools/extract_frames.py` -> `work/refs_raw/<name>.png` (frame 0, RGBA) -> `tools/normalize_refs.py` -> `work/refs/<name>.png` (native 1x pixels, read by everything else) -> `tools/crop_maps.py` -> `work/maps/<name>.png` (ROI crop). |
| Cropping | The outer UI frame and the right-hand asset showcase column of the source pictures are not part of the map and are cut by the `roi`. |

## Label files

`Label` (type in `app/src/viewer/labels.ts`):

| Field | Meaning |
|---|---|
| `id` | `L1`, `L2`, ... unique within the seed file. |
| `created`, `version`, `seed`, `novelty` | ISO time, generator version, seed and novelty at labelling time. |
| `options` | `GenOptions` snapshot: `novelty`, `experiments`, `exp{}`, `prune`, `pruneDraft`, `prefs`. Switches that no longer exist are ignored on replay. |
| `scene` | File name of the `.scene.json` the label refers to (stem = `seed<seed>` + `_n0.90` if novelty is not the default + `_p0` prune off + `_pd1` draft repairs + `_l0` prefs off + `_d<district>`). |
| `verdict` | `'good'` or `'bad'`. |
| `tags` | Fixed vocabulary in `app/src/viewer/labels.ts`: 6 good tags (e.g. 布局合理, 热闹不空) and 12 bad tags (e.g. 挡路, 重叠 / 穿插, 太空). |
| `text` | Free text typed by the user. |
| `target` | `{kind 'object'\|'building'\|'region', rect{x0,y0,x1,y1} px, objects[{id,key,cls,gid?,x,y}], gids[], zones[]}`. |

Who writes and reads them:

| Side | Where |
|---|---|
| Writer | Viewer label UI (`app/src/viewer/labels.ts`) -> `POST /api/labels` served by the vite plugin in `app/vite.config.ts` (`GET /api/labels?version=&seed=` loads them). Without the dev server labels stay in `localStorage`. |
| Reader (regression) | `app/scripts/labeltests.ts`, run by `npx tsx scripts/regress.ts labels` and `regress.ts report`: every label of every version is replayed; a bad label must be gone, a good one unchanged. |
| Reader (training) | `app/src/gen/learn/labels.ts` + `learn/data.ts`, used by `npx tsx scripts/prefs.ts train`; labels whose saved scene objects carry no `stream` (before v0.6.0) are skipped. |
| Reader (unit test) | `app/src/gen/deadend.test.ts` loads `labels/v0.7.4/*.scene.json` as fixtures for the dead-end path repair. |

## Commands

| Working dir | Command | Produces |
|---|---|---|
| `app` | `npx vite` | Dev server on :5173 with `/api/labels`; labels made in the viewer land in `references/labels/v<version>/`. |
| `app` | `npx tsx scripts/regress.ts labels` | Replays all labels as tests and prints the result. |
| `app` | `npx tsx scripts/prefs.ts train` | Reads `choices/` and `labels/` and writes `app/src/gen/data/prefs.json`. |
| `app` | `npm test` | 55 unit tests, including `deadend.test.ts` on the v0.7.4 scene fixtures (about 1 min). |
| `tools` | `sh run_analysis.sh` | Full analysis of the reference maps into `work/` (needs the maps and `assets/` on disk). |

## Notes

- `references/*.gif` and `references/*.png` are gitignored. A fresh clone has only `labels/`, `choices/` and this file, so
  the `tools/` pipeline cannot run without the maps; the TypeScript app and its tests do not need them.
- `labels/` and `choices/` JSON are tracked and are the only user-feedback data the trained preferences come from.
- Older scene stems carry experiment suffixes (`_exp-051_exp-061`, `_exp-071`, `_n0.60`) that the current viewer no longer
  emits; the files stay valid because labels name their scene file explicitly.
- `choices/` is read-only history: `/api/choices` and the viewer's B key were moved to `archive/ab/` in v0.7.6.
- The viewer refuses `version`/`seed` values that do not match `/^[\w.-]{1,80}$/` when saving.
- `references/holdout/` is mentioned in older docs but never existed.
- Label tags are Chinese strings; set `PYTHONIOENCODING=utf-8` when printing them from Python on a GBK console.
