"""Grid (tile-layer) model of each reference map.

Observation: ground AND buildings are placed on the 16px grid; props/vehicles are free.
For each map:
  1. find grid phase (ox, oy): score = textured pixels explained by opaque sheet tiles
     (flat tiles like plain asphalt carry no alignment evidence),
  2. per cell: base = opaque sheet tile with most inlier pixels (robust to occlusion by props),
  3. per cell: optional alpha overlay tile (curb, marking, roof edge...) composited on base.
Vocabulary = every unique tile of every combined sheet (work/tile_index.npz).

Output: work/grid/<name>.json  {phase, cols, rows, origin, cells[r][c] = [base_tid, over_tid|-1, frac] | null}
        work/grid/<name>_bg.png  rendered grid layer (RGBA, alpha 0 where unexplained)
Usage: uv run python grid_layer.py [names...]
"""
import sys, json
import numpy as np
from multiprocessing import Pool
from scipy.spatial import cKDTree
from PIL import Image
from common import *

TOL = 20
OUT = WORK/'grid'
_v = None

def vocab():
    global _v
    if _v is None:
        d = np.load(WORK/'tile_index.npz')
        tiles = d['tiles']
        al = tiles[..., 3] == 255
        op = al.all((1, 2))
        base_ids = np.nonzero(op)[0]
        over_ids = np.nonzero(~op & (al.sum((1, 2)) >= 8))[0]
        base = tiles[base_ids, ..., :3].astype(np.int16)
        med = np.median(base.reshape(len(base), -1, 3), 1)[:, None, None, :]
        tex = np.abs(base - med).max(-1) > 12
        sig = base.reshape(len(base), 4, 4, 4, 4, 3).mean((2, 4)).reshape(len(base), -1)
        _v = dict(base_ids=base_ids, base=base, tex=tex, over_ids=over_ids,
                  over=tiles[over_ids].astype(np.int16), tree=cKDTree(sig))
    return _v

def cell_sig(c):
    return c.reshape(4, 4, 4, 4, 3).mean((1, 3)).reshape(-1)

def best_base(cell, cand, valid=None):
    v = vocab()
    good = np.abs(v['base'][cand] - cell[None]).max(-1) <= TOL
    if valid is not None: good &= valid[None]
    n = good.sum((1, 2))
    j = int(n.argmax())
    return int(cand[j]), int(n[j]), good[j]

def phase_score(a, ox, oy, rng):
    v = vocab()
    cs = [c for _, _, c in cells(a, ox, oy)]
    if not cs: return 0
    idx = rng.choice(len(cs), min(150, len(cs)), replace=False)
    tot = 0
    for i in idx:
        c = cs[i].astype(np.int16)
        _, cand = v['tree'].query(cell_sig(c), k=8)
        bi, n, good = best_base(c, cand)
        tot += (good & v['tex'][bi]).sum()
    return tot / (len(idx) * 256)

def find_phase(a):
    scores = {(ox, oy): phase_score(a, ox, oy, np.random.default_rng(0)) for oy in range(T) for ox in range(T)}
    (ox, oy), sc = max(scores.items(), key=lambda kv: kv[1])
    return ox, oy, sc

def run(name, phase=None):
    v = vocab()
    a, _ = load_map(name)
    a = a[..., :3].astype(np.int16)
    H, W = a.shape[:2]
    ox, oy, sc = (*phase, -1) if phase else find_phase(a)
    # cells, including partial ones at the map border
    cx0, cy0 = -((ox + T - 1) // T), -((oy + T - 1) // T)
    cols, rows = (W - ox + T - 1) // T - cx0, (H - oy + T - 1) // T - cy0
    pad = np.full((H + 2 * T, W + 2 * T, 3), -999, np.int16); pad[T:T + H, T:T + W] = a
    bg = np.zeros((H, W, 4), np.uint8)
    out = [[None] * cols for _ in range(rows)]
    prev = {}
    for r in range(rows):
        for c in range(cols):
            ys, xs = oy + (cy0 + r) * T, ox + (cx0 + c) * T
            cell = pad[ys + T:ys + 2 * T, xs + T:xs + 2 * T]
            valid = cell[..., 0] != -999
            nv = int(valid.sum())
            if nv < 32: continue
            q = np.where(valid[..., None], cell, cell[valid].mean(0).astype(np.int16))
            _, cand = v['tree'].query(cell_sig(q), k=32)
            cand = list(cand) + [prev[k] for k in ((r - 1, c), (r, c - 1)) if k in prev]
            bi, n, good = best_base(cell, np.array(cand), valid)
            prev[(r, c)] = bi
            base = v['base'][bi]
            img, oid, gain = base, -1, 0
            if nv - n >= 8:
                ov = v['over']
                m = ov[..., 3] == 255
                comp = np.where(m[..., None], ov[..., :3], base[None])
                g2 = ((np.abs(comp - cell[None]).max(-1) <= TOL) & valid[None]).sum((1, 2)) - n
                j = int(g2.argmax())
                if g2[j] >= 8: img, oid, gain = comp[j], int(v['over_ids'][j]), int(g2[j])
            frac = (n + gain) / nv
            if frac < 0.3: continue
            out[r][c] = [int(v['base_ids'][bi]), oid, round(frac, 3)]
            y0, x0, y1, x1 = max(ys, 0), max(xs, 0), min(ys + T, H), min(xs + T, W)
            bg[y0:y1, x0:x1, :3] = img[y0 - ys:y1 - ys, x0 - xs:x1 - xs]
            bg[y0:y1, x0:x1, 3] = 255
    OUT.mkdir(exist_ok=True)
    json.dump(dict(name=name, phase=[ox, oy], phase_score=round(sc, 3), origin=[cx0, cy0], cols=cols, rows=rows,
                   cells=out), open(OUT/f'{name}.json', 'w'))
    Image.fromarray(bg).save(OUT/f'{name}_bg.png')
    known = bg[..., 3] > 0
    expl = known & (np.abs(bg[..., :3].astype(int) - a).max(-1) <= TOL)
    return f"{name:36s} phase=({ox:2d},{oy:2d}) score={sc:.3f} cells-known={known.mean():.2f} px-explained={expl.mean():.2f}"

if __name__ == '__main__':
    names = sys.argv[1:] or ref_names()
    with Pool(min(12, len(names))) as p:
        for line in p.imap_unordered(run, names): print(line, flush=True)
