"""Recognise grid-placed Singles (buildings, fences, ground decals, aligned props) from the grid layer.

Each Singles sprite is 16-aligned, so it is a small matrix of sheet tile ids (via exact pixel hash).
A placement (r0,c0) of sprite S matches if most of S's non-empty cells equal the base or overlay tile
found by grid_layer.py in the corresponding map cells. Greedy explanation (largest first) removes
sub-parts and duplicates.

Output: work/grid/<name>_objects.json  [{id,name,pack,r,c,x,y,tw,th,matched,cells}]
        work/sprite_tiles.json  (cached sprite -> tile-id matrix)
"""
import sys, json, hashlib
import numpy as np
from common import *

MIN_FRAC = 0.6

def tile_keymap():
    d = np.load(WORK/'tile_index.npz')
    return {hashlib.md5(t.tobytes()).hexdigest(): i for i, t in enumerate(d['tiles'])}

def sprite_tiles():
    p = WORK/'sprite_tiles.json'
    if p.exists(): return json.load(open(p))
    km = tile_keymap()
    cat = json.load(open(WORK/'catalog.json'))
    out = {}
    for r in cat:
        if r['dup_of'] is not None: continue
        a = load_rgba(ASSETS/r['file'])
        mat = []
        for cy in range(r['th']):
            row = []
            for cx in range(r['tw']):
                t = a[cy*T:(cy+1)*T, cx*T:(cx+1)*T].copy()
                if t[..., 3].max() == 0: row.append(-2); continue      # empty cell
                t[t[..., 3] == 0] = 0
                row.append(km.get(hashlib.md5(t.tobytes()).hexdigest(), -1))  # -1: not in any sheet
            mat.append(row)
        out[str(r['id'])] = mat
    json.dump(out, open(p, 'w'))
    return out

def run(name):
    cat = {r['id']: r for r in json.load(open(WORK/'catalog.json'))}
    st = sprite_tiles()
    g = json.load(open(WORK/'grid'/f'{name}.json'))
    R, C = g['rows'], g['cols']
    Gb = np.full((R, C), -9); Go = np.full((R, C), -9)
    for r in range(R):
        for c in range(C):
            v = g['cells'][r][c]
            if v: Gb[r, c], Go[r, c] = v[0], v[1]
    dets = []
    for sid, mat in st.items():
        m = np.array(mat)
        th, tw = m.shape
        cellsS = [(i, j, m[i, j]) for i in range(th) for j in range(tw) if m[i, j] >= 0]
        need = (m != -2).sum()
        if not cellsS or len(cellsS) < MIN_FRAC * need: continue
        # placements may hang over the map edge by up to th-1 / tw-1 cells
        PR, PC = R + th - 1, C + tw - 1
        cnt = np.zeros((PR, PC), np.int32)
        for i, j, tid in cellsS:
            hit = (Gb == tid) | (Go == tid)
            # placement p=(pr,pc) -> map cell (pr-(th-1)+i, pc-(tw-1)+j)
            cnt[th-1-i:th-1-i+R, tw-1-j:tw-1-j+C] += hit
        # visible cells per placement
        vis = np.zeros((PR, PC), np.int32)
        inmap = np.ones((R, C), np.int32)
        for i in range(th):
            for j in range(tw):
                if m[i, j] != -2: vis[th-1-i:th-1-i+R, tw-1-j:tw-1-j+C] += inmap
        ok = (cnt >= np.maximum(1, MIN_FRAC * vis)) & (vis >= np.maximum(1, 0.4 * need))
        for pr, pc in zip(*np.nonzero(ok)):
            r0, c0 = pr - (th - 1), pc - (tw - 1)
            cl = [(r0+i, c0+j) for i, j, tid in cellsS
                  if 0 <= r0+i < R and 0 <= c0+j < C and (Gb[r0+i, c0+j] == tid or Go[r0+i, c0+j] == tid)]
            dets.append((len(cl), int(sid), int(r0), int(c0), th, tw, cl, int(vis[pr, pc])))
    # greedy explanation; a cell may be claimed twice (base + overlay) -> track per (cell, layer tid)
    dets.sort(key=lambda d: (-d[0], -d[0] / d[7]))
    claimed, kept = set(), []
    for n, sid, r0, c0, th, tw, cl, vis in dets:
        m = np.array(st[str(sid)])
        keys = {(r, c, int(m[r - r0, c - c0])) for r, c in cl}
        new = [k for k in keys if k not in claimed]
        if len(new) < max(1, 0.5 * len(keys)): continue
        # single-cell sprites only count if the tile is not a plain ground tile repeated everywhere
        claimed |= keys
        rc = cat[sid]
        ox, oy = g['phase']; cx0, cy0 = g['origin']
        kept.append(dict(id=sid, name=rc['name'], pack=rc['pack'], r=r0, c=c0,
                         x=ox + (cx0 + c0) * T, y=oy + (cy0 + r0) * T, tw=tw, th=th,
                         matched=n, visible=vis))
    json.dump(kept, open(WORK/'grid'/f'{name}_objects.json', 'w'), indent=0)
    return kept

if __name__ == '__main__':
    sprite_tiles()
    for n in sys.argv[1:] or ref_names():
        if not (WORK/'grid'/f'{n}.json').exists(): continue
        k = run(n)
        big = [o for o in k if o['tw'] * o['th'] >= 4]
        print(f"{n:36s} grid objects={len(k):4d} (>=4 cells: {len(big)})")
