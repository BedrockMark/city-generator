"""Derive 47-blob autotile tables from the Game Maker Studio autotile sheet (12 cols x 4 rows per terrain).

For each tile, sample 8 border regions (N, NE, E, SE, S, SW, W, NW) and decide whether the terrain
('inside') extends toward that neighbour. Canonical blob mask: corner bits only count when both adjacent
edge bits are set. Output work/autotile.json: {block_name: {"row0": r, "masks": {mask: [col,row]}}}

Bit order: N=1, NE=2, E=4, SE=8, S=16, SW=32, W=64, NW=128.
Usage: uv run python autotile.py
"""
import json
import numpy as np
from common import *

SHEET = ASSETS/'exterior_autotiles'/'Game_Maker_Studio_Autotiles_16x16.png'
BLOCKS = {  # name: first row of the 4-row block (from sheet_grid inspection)
    'sidewalk_lightbeige': 72, 'sidewalk_beige': 76, 'sidewalk_lightgrey': 80, 'sidewalk_grey': 84,
    'sidewalk_brown': 88, 'sidewalk_blue': 92,
}
BITS = dict(N=1, NE=2, E=4, SE=8, S=16, SW=32, W=64, NW=128)
R = {  # (y0,y1,x0,x1) sample regions, 2px deep from the border
    'N': (0, 3, 6, 10), 'S': (13, 16, 6, 10), 'W': (6, 10, 0, 3), 'E': (6, 10, 13, 16),
    'NE': (0, 3, 13, 16), 'NW': (0, 3, 0, 3), 'SE': (13, 16, 13, 16), 'SW': (13, 16, 0, 3),
}

def canon(m):
    for c, a, b in (('NE', 'N', 'E'), ('SE', 'S', 'E'), ('SW', 'S', 'W'), ('NW', 'N', 'W')):
        if not (m & BITS[a] and m & BITS[b]): m &= ~BITS[c]
    return m

def main():
    a = load_rgba(SHEET).astype(int)
    out = {}
    for name, r0 in BLOCKS.items():
        blk = a[r0 * T:(r0 + 4) * T]
        lum = 0.3 * blk[..., 0] + 0.59 * blk[..., 1] + 0.11 * blk[..., 2]
        inside = (lum > 110) & (blk[..., 3] > 0)
        masks = {}
        for k in range(1, 48):
            r, c = divmod(k, 12)
            t = inside[r * T:(r + 1) * T, c * T:(c + 1) * T]
            if not (blk[r * T:(r + 1) * T, c * T:(c + 1) * T, 3] > 0).any(): continue
            m = 0
            for d, (y0, y1, x0, x1) in R.items():
                if t[y0:y1, x0:x1].mean() > 0.5: m |= BITS[d]
            m = canon(m)
            masks.setdefault(m, [c, r0 + r])
        out[name] = dict(row0=r0, masks={str(k): v for k, v in sorted(masks.items())})
        print(f'{name:22s} distinct masks={len(masks)} full={"255" in out[name]["masks"]}')
    json.dump(out, open(WORK/'autotile.json', 'w'), indent=1)

if __name__ == '__main__':
    main()
