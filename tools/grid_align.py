"""Find 16px grid phase of each native reference by exact-matching fully-opaque sheet tiles.
Writes work/grid.json {name: {ox, oy, match_frac, cols, rows}}."""
import json
import numpy as np
from common import *
d = np.load(WORK/'tile_index.npz'); tiles = d['tiles']
op = (tiles[..., 3] == 255).all((1, 2))
H = {tiles[i, ..., :3].tobytes() for i in np.nonzero(op)[0]}
res = {}
for p in sorted(REFS.glob('*.png')):
    a = load_rgba(p)[..., :3]
    best = (0, 0, 0)
    for oy in range(T):
        for ox in range(T):
            n = tot = 0
            for _, _, t in cells(a, ox, oy):
                tot += 1; n += t.tobytes() in H
            best = max(best, (n / max(tot, 1), ox, oy))
    f, ox, oy = best
    res[p.stem] = dict(ox=ox, oy=oy, match_frac=round(f, 3),
                       cols=(a.shape[1]-ox)//T, rows=(a.shape[0]-oy)//T)
    print(f"{p.stem:40s} phase=({ox:2d},{oy:2d}) exact-opaque-match={f:.3f} grid={res[p.stem]['cols']}x{res[p.stem]['rows']}")
json.dump(res, open(WORK/'grid.json', 'w'), indent=1)
