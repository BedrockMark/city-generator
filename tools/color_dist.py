"""Distance from each reference colour to nearest asset colour (to calibrate tolerant matching)."""
import sys
import numpy as np
from scipy.spatial import cKDTree
from common import *
d = np.load(WORK/'tile_index.npz'); t = d['tiles']
pal = np.unique(t[t[..., 3] == 255][:, :3], axis=0).astype(float)
tree = cKDTree(pal)
for name in sys.argv[1:]:
    a = load_rgba(REFS/f'{name}.png')[..., :3].reshape(-1, 3).astype(float)
    dist, idx = tree.query(a)
    q = np.percentile(dist, [50, 75, 90, 95, 99])
    diff = a - pal[idx]
    print(f"{name:35s} pct50/75/90/95/99={np.round(q,1)} mean signed diff={np.round(diff.mean(0),2)}")
