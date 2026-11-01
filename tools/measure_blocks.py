"""Measure road widths, sidewalk depths and visible block extents from scene ground classes.

For every column: vertical runs of 'road' cells bounded on both ends by known non-road cells -> widths of
horizontal roads (only counted where the road continues horizontally >= MIN_LEN cells). Same for rows.
Sidewalk depth: run of 'paved' cells perpendicular to a road edge until building/structure/grass/other.
Block extent: connected components of non-road known cells (border-touching components are reported as
'cut by frame' lower bounds).
Usage: uv run python measure_blocks.py [names...]   (default: street refs + anti)
"""
import sys, json
import numpy as np
from collections import Counter
from scipy.ndimage import label
from common import *

MIN_LEN = 5

def runs(line):
    """yield (start, length, value) for runs of equal values."""
    s = 0
    for i in range(1, len(line) + 1):
        if i == len(line) or line[i] != line[s]:
            yield s, i - s, line[s]; s = i

def road_widths(G):
    road = G == 'road'
    out = Counter()
    for axis in (0, 1):
        M = road if axis == 0 else road.T
        Gx = G if axis == 0 else G.T
        for j in range(M.shape[1]):
            col = M[:, j]
            for s, n, v in runs(list(col)):
                if not v or s == 0 or s + n >= len(col): continue
                if Gx[s - 1, j] == '' or Gx[s + n, j] == '': continue
                # road must run along the perpendicular axis
                rowlen = M[s:s + n, max(0, j - MIN_LEN // 2):j + MIN_LEN // 2 + 1].all(0).sum()
                if rowlen >= MIN_LEN: out[n] += 1
    return out

def sidewalk_depths(G):
    out = Counter()
    for M in (G, G.T, G[::-1], G.T[::-1]):
        for j in range(M.shape[1]):
            col = list(M[:, j])
            for i in range(1, len(col)):
                if col[i - 1] == 'road' and col[i] == 'paved':
                    k = i
                    while k < len(col) and col[k] == 'paved': k += 1
                    if k < len(col) and col[k] in ('building', 'structure', 'grass', 'dirt', 'other'):
                        out[k - i] += 1
    return out

def blocks(G):
    nonroad = (G != 'road') & (G != '')
    lab, n = label(nonroad)
    res = []
    for k in range(1, n + 1):
        ys, xs = np.nonzero(lab == k)
        if len(ys) < 6: continue
        cut = ys.min() == 0 or xs.min() == 0 or ys.max() == G.shape[0] - 1 or xs.max() == G.shape[1] - 1
        res.append(dict(w=int(xs.max() - xs.min() + 1), h=int(ys.max() - ys.min() + 1), cells=int(len(ys)), cut=bool(cut)))
    return res

if __name__ == '__main__':
    names = sys.argv[1:] or ref_names(('street', 'anti'))
    tw, ts = Counter(), Counter()
    for n in names:
        p = WORK/'scenes'/f'{n}.json'
        if not p.exists(): continue
        G = np.array(json.load(open(p))['ground'], dtype=object)
        w, s, b = road_widths(G), sidewalk_depths(G), blocks(G)
        if not n.startswith('ANTI'): tw += w; ts += s
        cls = Counter(G.ravel())
        print(f"{n:34s} grid={G.shape[1]}x{G.shape[0]} road-widths={dict(sorted(w.items()))} sidewalk={dict(sorted(s.items()))}")
        print(f"{'':34s} ground={dict(cls.most_common(6))}")
        print(f"{'':34s} blocks={[(x['w'], x['h'], 'cut' if x['cut'] else 'full') for x in sorted(b, key=lambda x: -x['cells'])[:4]]}")
    print('\nALL street refs: road widths', dict(sorted(tw.items())), '\nsidewalk depths', dict(sorted(ts.items())))
