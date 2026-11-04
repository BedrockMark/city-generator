"""Copy / repetition checker on the common scene format.

Two independent signals, both computed against a set of reference scenes:
  1. TILE WINDOWS: every KxK window of grid cells (base+overlay tile ids) that is not trivially
     uniform. A window is 'copied' if the identical window exists in any reference. We report the
     fraction of copied windows and the largest 4-connected region (in cells) covered by copied windows.
  2. OBJECT CONSTELLATIONS: for each object, its neighbours within R px as (sprite id, dx, dy) with
     2px quantisation. If >= MIN_SHARED neighbours coincide exactly with some reference object of the
     same sprite id, the object is part of a copied constellation.
Also 'self' mode: the same measures of a scene against ITSELF at other positions -> detects the
internal copy-paste look (same block stamped repeatedly).

Usage:
  uv run python novelty.py baseline                 # each reference vs. all OTHER references (calibration)
  uv run python novelty.py check scene.json [...]   # generated scenes vs. all references (+ self-repetition)
"""
import sys, json
import numpy as np
from collections import defaultdict
from scipy.ndimage import label, binary_dilation
from common import *

K = 4
R = 64
MIN_SHARED = 3

def windows(sc):
    """dict hash -> list of (r,c) for non-uniform KxK windows (all cells known)."""
    cells = sc['cells']; Rr, C = sc['rows'], sc['cols']
    out = defaultdict(list)
    for r in range(Rr - K + 1):
        for c in range(C - K + 1):
            w = []
            ok = True
            for i in range(K):
                for j in range(K):
                    v = cells[r + i][c + j]
                    if not v: ok = False; break
                    w.append((v[0], v[1]))
                if not ok: break
            if not ok or len(set(w)) <= 2: continue    # unknown or near-uniform (plain asphalt etc.)
            out[hash(tuple(w))].append((r, c))
    return out

def constellations(sc):
    objs = [o for o in sc['objects'] if o['cls'] != 'building']
    P = np.array([[o['x'], o['y']] for o in objs], float).reshape(-1, 2)
    res = []
    for i, o in enumerate(objs):
        d = np.hypot(*(P - P[i]).T)
        nb = frozenset((objs[j]['sid'], int(P[j, 0] - P[i, 0]) // 2, int(P[j, 1] - P[i, 1]) // 2)
                       for j in np.nonzero((d < R) & (d > 0))[0])
        res.append((o['sid'], nb, o))
    return res

def compare(sc, refs, exclude_self_pos=False):
    W = windows(sc)
    refW = set()
    for rs in refs: refW |= set(windows(rs).keys())
    hit = np.zeros((sc['rows'], sc['cols']), bool)
    tot = sum(len(v) for v in W.values()); ncopied = 0
    for h, poss in W.items():
        if h in refW:
            ncopied += len(poss)
            for r, c in poss: hit[r:r + K, c:c + K] = True
    lab, n = label(hit)
    largest = int(np.bincount(lab.ravel())[1:].max()) if n else 0
    # constellations
    refC = defaultdict(list)
    for rs in refs:
        for sid, nb, _ in constellations(rs): refC[sid].append(nb)
    mine = constellations(sc)
    copied = 0
    for sid, nb, _ in mine:
        if len(nb) < MIN_SHARED: continue
        if any(len(nb & rnb) >= MIN_SHARED for rnb in refC.get(sid, [])): copied += 1
    return dict(windows=tot, copied_windows=ncopied, copied_window_frac=round(ncopied / max(tot, 1), 3),
                largest_copied_region_cells=largest, objects=len(mine), objects_in_copied_constellation=copied,
                copied_object_frac=round(copied / max(len(mine), 1), 3))

def self_repetition(sc):
    """windows occurring >= 2 times at non-overlapping positions within the same scene."""
    W = windows(sc)
    rep = 0; tot = 0
    for poss in W.values():
        tot += len(poss)
        far = [p for p in poss if any(abs(p[0] - q[0]) >= K or abs(p[1] - q[1]) >= K for q in poss)]
        rep += len(far)
    return dict(windows=tot, repeated_window_frac=round(rep / max(tot, 1), 3))

def load(n): return json.load(open(WORK/'scenes'/f'{n}.json'))

if __name__ == '__main__':
    mode = sys.argv[1]
    names = [n for n in ref_names() if (WORK/'scenes'/f'{n}.json').exists()]
    if mode == 'baseline':
        scenes = {n: load(n) for n in names}
        print(f"{'ref':36s} {'copied_win':>10s} {'largest':>8s} {'copied_obj':>10s} {'self_rep':>8s}")
        for n, sc in scenes.items():
            grp = META[n].get('group')
            others = [s for m, s in scenes.items() if m != n]
            others_nogroup = [s for m, s in scenes.items() if m != n and (grp is None or META[m].get('group') != grp)]
            c = compare(sc, others_nogroup); s = self_repetition(sc)
            cg = compare(sc, others) if grp else c
            print(f"{n:36s} {c['copied_window_frac']:10.3f} {c['largest_copied_region_cells']:8d} "
                  f"{c['copied_object_frac']:10.3f} {s['repeated_window_frac']:8.3f}"
                  + (f"   (incl. same-group: win {cg['copied_window_frac']:.3f}, largest {cg['largest_copied_region_cells']})" if grp else ''))
    elif mode == 'check':
        refs = [load(n) for n in names]
        for p in sys.argv[2:]:
            sc = json.load(open(p))
            print(p, compare(sc, refs), self_repetition(sc))

def self_constellations(sc, R2=64, q=4, min_nb=2):
    """fraction of objects whose neighbourhood (sprite ids + offsets within R2 px, quantised by q px; >= min_nb
    neighbours) occurs again around another object of the same sprite elsewhere in the same scene (>= R2 px away).
    Detects stamped copies (identical building+surroundings) independent of ground texture."""
    objs = [o for o in sc['objects'] if o.get('conf', 'high') != 'low']
    P = np.array([[o['x'], o['y']] for o in objs], float).reshape(-1, 2)
    sig = {}
    for i, o in enumerate(objs):
        d = np.hypot(*(P - P[i]).T)
        nb = frozenset((objs[j]['sid'], int(P[j, 0] - P[i, 0]) // q, int(P[j, 1] - P[i, 1]) // q) for j in np.nonzero((d < R2) & (d > 0))[0])
        if len(nb) >= min_nb: sig.setdefault((o['sid'], nb), []).append(P[i])
    rep = 0; tot = 0
    for poss in sig.values():
        tot += len(poss)
        if len(poss) > 1:
            for p in poss:
                if any(np.hypot(*(p - p2)) >= R2 for p2 in poss): rep += 1
    return dict(objects=len(objs), with_neighbours=tot, repeated_constellation_frac=round(rep / max(tot, 1), 3))

def constellation_overlap(a, b, R2=64, q=4, min_nb=2):
    """fraction of a's object neighbourhoods that also occur in b (seed-vs-seed diversity)"""
    def sigs(sc):
        objs = sc['objects']; P = np.array([[o['x'], o['y']] for o in objs], float).reshape(-1, 2); out = set()
        for i, o in enumerate(objs):
            d = np.hypot(*(P - P[i]).T)
            nb = frozenset((objs[j]['sid'], int(P[j, 0] - P[i, 0]) // q, int(P[j, 1] - P[i, 1]) // q) for j in np.nonzero((d < R2) & (d > 0))[0])
            if len(nb) >= min_nb: out.add((o['sid'], nb))
        return out
    sa, sb = sigs(a), sigs(b)
    return round(len(sa & sb) / max(len(sa), 1), 3)
