"""Downscale references to native 1x pixels -> work/refs/<name>.png (RGBA).
Picks best integer scale & phase by block consistency."""
from pathlib import Path
import numpy as np
from PIL import Image
root = Path(__file__).resolve().parent.parent
src = root/'work'/'refs_raw'; out = root/'work'/'refs'; out.mkdir(parents=True, exist_ok=True)
def consistency(a, s, ox, oy):
    a = a[oy:, ox:]; h2, w2 = (a.shape[0]//s)*s, (a.shape[1]//s)*s
    a = a[:h2, :w2].reshape(h2//s, s, w2//s, s, -1)
    return float((a == a[:, :1, :, :1]).all(-1).mean())
for p in sorted(src.glob('*.png')):
    a = np.asarray(Image.open(p).convert('RGBA'))
    best = (1, 0, 0)
    for s in (2, 3, 4):
        c, ox, oy = max((consistency(a, s, ox, oy), ox, oy) for ox in range(s) for oy in range(s))
        if c > 0.95: best = (s, ox, oy)
    s, ox, oy = best
    b = a[oy::s, ox::s]
    Image.fromarray(b).save(out/p.name)
    print(f"{p.stem:40s} scale={s} phase=({ox},{oy}) -> {b.shape[1]}x{b.shape[0]}")
