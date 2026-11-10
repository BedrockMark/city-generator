# assets/

The 16x16 pixel-art tileset that the reference maps in [`references/`](../references/README.md) were drawn with and that
the generator and the Phaser viewer in [`app/`](../app/README.md) draw from. The folder is **not part of the repository**
(`.gitignore`: `assets/*`, only this README is tracked); it is assumed to be present at `<repo>/assets/` in the vendor
pack's original layout, as described below. The Python tools in [`tools/`](../tools/README.md) scan it to build the sprite
catalog and the asset metadata the generator ships with.

## Expected layout

| Path | Purpose |
|---|---|
| `exteriors/<N>_<Pack>_16x16.png` | 24 combined sheets, `N` = 1..24 (`1_Terrains_and_Fences`, `2_City_Terrains`, `3_City_Props`, `4_Generic_Buildings`, `5_Floor_Modular_Buildings`, `6_Garage_Sales`, `7_Villas`, `8_Worksite`, `9_Shopping_Center_and_Markets`, `10_Vehicles`, `11_Camping`, `12_Hotel_and_Hospital`, `13_School`, `14_Swimming_Pool`, `15_Police_Station`, `16_Office`, `17_Garden`, `18_Fire_Station`, `19_Graveyard`, `20_Subway_and_Train_Station`, `21_Beach`, `22_Post_Office`, `23_MIlitary_Base`, `24_Additional_Houses`). |
| `exteriors/<N>_<Pack>_Singles_16x16/` | 22 folders of individual sprites (packs 3..24; the two terrain packs have no Singles). Files are named `ME_Singles_<Pack>_16x16_<Name>.png`. |
| `exterior_autotiles/Game_Maker_Studio_Autotiles_16x16.png` | 47-blob autotile sheet used for the ground layer (scene `sheets.auto`). |
| `exterior_autotiles/Game_Maker_Studio_Autotiles_Singles_16x16/` | The same autotiles as single files (`..._Singles_16x16_<n>.png`). |
| `exterior_autotiles/Godot_Autotiles_16x16.png` | Duplicate of the GMS sheet in Godot order; skipped by `tools/common.py sheets()`. |
| `charactors/` (sic) | Character layer sheets, 13 folders: `Bodies`, `Bodies_kids`, `Eyes`, `Eyes_kids`, `Outfits`, `Outfits_kids`, `Hairstyles`, `Hairstyles_kids`, `Accessories`, `Skins`, `Books`, `Smartphones`, plus `CHARACTER_GENERATOR.txt` and `Spritesheet_animations_GUIDE.png`. Frames are 16x32 on a 56-column grid. |
| `README.md` | This file (the only tracked path under `assets/`). |

Roughly 6300 files in total (about 6280 PNG). The folder names `charactors` and `23_MIlitary_Base` are the vendor's
spelling and are load-bearing in code paths and saved scenes; do not rename anything.

## Who uses it

| Consumer | How |
|---|---|
| `app/public/assets` | Junction / symlink to `../../assets`, gitignored, created once by hand (see Commands). The viewer loads sheets and Singles from `assets/...` URLs (`ASSET_ROOT = 'assets/'` in `app/src/main.ts`). |
| `tools/common.py` | `ASSETS = ROOT/'assets'`; `sheets()` = the combined sheets, `singles()` = every PNG inside a `*Singles*` folder. All analysis scripts go through these. |
| `tools/build_tile_index.py`, `tools/build_catalog.py` | Index every 16x16 cell of the sheets and every Singles sprite into `work/tile_index.*` and `work/catalog.json`. |
| `tools/export_manifest.py` | Reads `work/catalog.json` and keeps the Singles of 18 packs (`3_City_Props`, `4_Generic_Building`, `5_Floor_Modular_Building`, `6_Garage_Sales`, `7_Villas`, `8_Worksite`, `9_Shopping_Center`, `10_Vehicles`, `11_Camping`, `12_Hotel`, `13_School`, `14_Swimming_Pool`, `15_Police_Station`, `16_Office`, `17_Garden`, `18_Fire_Station`, `22_Post_Office`, `24_Additional_Houses`) as `app/src/gen/data/sprites.json` (key `<pack>/<name>`); also copies `work/autotile.json` and writes `characters.json`. |
| `tools/export_opaque.py` | Opaque-pixel masks per sprite into `app/src/gen/data/opaque.json`. |
| `tools/autotile.py` | Derives `work/autotile.json` from the GMS autotile sheet. |
| `tools/characters.py`, `app/src/gen/people.ts` | Composite characters body -> eyes -> outfit -> hairstyle -> accessory from `charactors/`. |
| Scene JSON `sheets` | Every saved scene references `exteriors/2_City_Terrains_16x16.png`, `exteriors/1_Terrains_and_Fences_16x16.png` and `exterior_autotiles/Game_Maker_Studio_Autotiles_16x16.png` by these exact paths. |

## Commands

| Working dir | Command | Produces |
|---|---|---|
| `app/public` | Windows cmd: `mklink /J assets ..\..\assets`; PowerShell: `New-Item -ItemType Junction -Path assets -Target (Resolve-Path ..\..\assets)`; sh: `ln -s ../../assets assets` | The `app/public/assets` link the dev server needs. Verify with `ls app/public/assets`. |
| `tools` | `sh run_analysis.sh` | Scans `assets/` (and the reference maps) into `work/tile_index.*`, `work/catalog.*` and the per-reference analysis folders. |
| `tools` | `uv run python export_manifest.py && uv run python export_opaque.py` | Regenerates `app/src/gen/data/{sprites,autotile,characters,opaque}.json`; needs `work/catalog.json` from `build_catalog.py` first. |

## Notes

- Nothing under `assets/` except this README is published; the tileset is third-party and assumed to be provided
  separately. The metadata the generator actually runs on (`app/src/gen/data/*.json`) is tracked, so the generator,
  the headless scripts and `npm test` work without the tileset. The viewer, `tools/render_generated.py` and the analysis
  scripts need the real PNGs.
- `app/public/assets` must point at this folder; no script in the repo creates the link even though
  `app/vite.config.ts` says "created by setup".
- `tools/common.py` resolves the folder relative to the repo root, so the tileset cannot live anywhere else without
  editing `ASSETS`.
- The pack ships Windows `desktop.ini` files; they are harmless and ignored by the scanners (only `*.png` is read).
- Some Singles file names contain stray spaces (e.g. `..._16x16_ Big_Large_Tunnel_Cornice.png`, `..._Left_Down_1 .png`);
  keep them as they are, the catalog keys are derived from them.
