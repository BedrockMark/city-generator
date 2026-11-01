"""Fraction of reference pixel colours that exist exactly in the asset colour set (detect GIF quantisation)."""
import numpy as np
from common import *
d = np.load(WORK/'tile_index.npz'); t = d['tiles']
c = t[t[..., 3] == 255][:, :3].astype(np.int32)
S = np.unique(c[:, 0] << 16 | c[:, 1] << 8 | c[:, 2])
for p in sorted(REFS.glob('*.png')):
    a = load_rgba(p)[..., :3].reshape(-1, 3).astype(np.int32)
    k = a[:, 0] << 16 | a[:, 1] << 8 | a[:, 2]
    u = np.unique(k)
    print(f"{p.stem:40s} pix-in-assets={np.isin(k, S).mean():.3f} unique-colors={len(u)} unique-in-assets={np.isin(u,S).mean():.3f}")
