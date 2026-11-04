"""Stage 6 judge: data tables that put generated scenes on the same footing as the analysed references.

  uv run python export_judge_data.py   -> app/src/gen/data/tileclass.json, app/src/gen/data/semclass.json

tileclass.json: {sheet: [[cls, opaque], ...]} indexed row * cols + col, for the three ground sheets of
  app/src/gen/types.ts SHEETS. cls = semantics.ground_class of the tile's opaque pixels (the rule that classes the
  reference ground), opaque = share of opaque pixels. Fully transparent tiles: ['', 0].
semclass.json: {"<pack>/<name>": semantics.sprite_class(name, pack)} for every sprite of sprites.json, so generated
  objects get the same 17 classes as reference detections.
"""
import json
import numpy as np
from common import *
from semantics import ground_class, sprite_class

OUT = ROOT/'app'/'src'/'gen'/'data'
SHEETS = {'city': 'exteriors/2_City_Terrains_16x16.png',
          'auto': 'exterior_autotiles/Game_Maker_Studio_Autotiles_16x16.png',
          'terr': 'exteriors/1_Terrains_and_Fences_16x16.png'}

def tile_table(path):
    a = load_rgba(ASSETS/path)
    rows, cols = a.shape[0] // T, a.shape[1] // T
    out = []
    for r in range(rows):
        for c in range(cols):
            t = a[r*T:(r+1)*T, c*T:(c+1)*T]
            m = t[:, :, 3] > 0
            op = float(m.mean())
            if not m.any(): out.append(['', 0]); continue
            px = t[:, :, :3][m].reshape(-1, 1, 3)   # opaque pixels only
            out.append([ground_class(px), round(op, 2)])
    return out

def main():
    tc = {k: tile_table(p) for k, p in SHEETS.items()}
    json.dump(tc, open(OUT/'tileclass.json', 'w'), separators=(',', ':'))
    sp = json.load(open(OUT/'sprites.json'))
    sc = {k: sprite_class(k.split('/', 1)[1], k.split('/', 1)[0]) for k in sp}
    json.dump(sc, open(OUT/'semclass.json', 'w'), separators=(',', ':'), indent=0)
    print({k: len(v) for k, v in tc.items()}, f'{len(sc)} sprite classes -> {OUT}')

if __name__ == '__main__':
    main()
