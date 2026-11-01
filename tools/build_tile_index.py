"""Index every 16x16 cell of every combined sheet. Output work/tile_index.npz:
 tiles (N,16,16,4) uint8, src (N,) sheet id, pos (N,2) cell xy; plus sheet names.
Duplicates (identical RGBA) are collapsed, keeping all sources in a json side file."""
import json, hashlib
import numpy as np
from common import *
tiles, src, pos, keymap = [], [], [], {}
names = [p.relative_to(ASSETS).as_posix() for p in sheets()]
dups = {}
for si, p in enumerate(sheets()):
    a = load_rgba(p)
    for cx, cy, t in cells(a):
        if t[..., 3].max() == 0: continue
        t = t.copy(); t[t[..., 3] == 0] = 0
        k = hashlib.md5(t.tobytes()).hexdigest()
        if k in keymap:
            dups.setdefault(keymap[k], []).append([si, cx, cy]); continue
        keymap[k] = len(tiles)
        tiles.append(t); src.append(si); pos.append((cx, cy))
tiles = np.stack(tiles)
np.savez_compressed(WORK/'tile_index.npz', tiles=tiles, src=np.array(src), pos=np.array(pos))
json.dump({'sheets': names, 'dups': {str(k): v for k, v in dups.items()}}, open(WORK/'tile_index.json', 'w'))
opaque = (tiles[..., 3] == 255).all((1, 2)).sum()
print(f"unique tiles {len(tiles)}, fully opaque {opaque}, sheets {len(names)}")
