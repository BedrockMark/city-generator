"""Export coarse opacity masks of building sprites -> app/src/gen/data/opaque.json

{"<key>": [cols, rows, ["<hex row>", ...]]}: one bit per 4x4 px block, set when every pixel of the block is opaque.
The generator uses it to check that something standing behind a building is completely hidden by it
(building outlines are not rectangles: terraced houses have gaps between roof sections, roofs have transparent rims).
Usage: uv run python export_opaque.py      (after export_manifest.py)
"""
import json, re
import numpy as np
from PIL import Image
from common import *

OUT = ROOT/'app'/'src'/'gen'/'data'
B = 4
BUILDING = re.compile(r'^(4_Generic_Building/|5_Floor_Modular_Building/(Roof|Middle_Floor|Ground_Floor)|9_Shopping_Center_and_Markets/Market_Medium|'
                      r'24_Additional_Houses/24_(Terraced|Victorian)_House_\d+$)')

def main():
    sp = json.load(open(OUT/'sprites.json'))
    out = {}
    for key, v in sp.items():
        if not BUILDING.match(key): continue
        a = np.asarray(Image.open(ASSETS/v[0]).convert('RGBA'))[:, :, 3] > 0
        h, w = a.shape[0] // B, a.shape[1] // B
        blocks = a[:h * B, :w * B].reshape(h, B, w, B).all(axis=(1, 3))
        rows = []
        for r in blocks:
            bits = ''.join('1' if b else '0' for b in r).ljust(-(-w // 4) * 4, '0')
            rows.append(''.join(f'{int(bits[i:i + 4], 2):x}' for i in range(0, len(bits), 4)))
        out[key] = [w, h, rows]
    json.dump(out, open(OUT/'opaque.json', 'w'), separators=(',', ':'))
    print(f'{len(out)} building masks -> {OUT/"opaque.json"}')

if __name__ == '__main__':
    main()
