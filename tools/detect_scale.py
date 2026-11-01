"""Detect integer upscale factor and pixel phase of each reference (nearest-neighbour upscales)."""
from pathlib import Path
import numpy as np
from PIL import Image
root = Path(__file__).resolve().parent.parent
def block_consistency(a, s, ox, oy):
    h, w = a.shape[:2]
    a = a[oy:, ox:]
    h2, w2 = (a.shape[0]//s)*s, (a.shape[1]//s)*s
    a = a[:h2, :w2].reshape(h2//s, s, w2//s, s, -1)
    ref = a[:, :1, :, :1]
    return float((a == ref).all(-1).mean())
for p in sorted((root/'work'/'refs_raw').glob('*.png')):
    a = np.asarray(Image.open(p).convert('RGB'))
    res = []
    for s in (1,2,3,4):
        best = max(((block_consistency(a,s,ox,oy),ox,oy) for ox in range(s) for oy in range(s)))
        res.append((s,)+best)
    print(p.stem.ljust(40), '  '.join(f"s{s}:{c:.3f}@({ox},{oy})" for s,c,ox,oy in res))
