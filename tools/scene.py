"""Common scene format + renderer + reconstruction check.

Scene JSON (used for analysed references AND, later, generator output):
{
  "name": str, "size": [W, H] px, "phase": [ox, oy], "origin": [cx0, cy0], "cols": C, "rows": R,
  "cells": [[[base_tid, over_tid] | null, ...], ...],        # grid tile layer (tile ids of work/tile_index.npz)
  "ground": [[class, ...], ...],                              # semantic class per cell (road/paved/grass/building/...)
  "objects": [{"sid": sprite id (catalog), "name", "pack", "cls", "x", "y", "w", "h", "grid": bool}]
}
Usage:
  uv run python scene.py export [names...]   -> work/scenes/<name>.json  (+ _recon.png, _diff.png)
"""
import sys, json
import numpy as np
from PIL import Image
from common import *
from semantics import sprite_class, ground_class

TOL = 20
_tiles = None
def tiles():
    global _tiles
    if _tiles is None: _tiles = np.load(WORK/'tile_index.npz')['tiles']
    return _tiles

def terrain_tile_set():
    meta = json.load(open(WORK/'tile_index.json'))
    sheets = meta['sheets']
    terr = {i for i, s in enumerate(sheets) if s.split('/')[-1].startswith(('1_', '2_', 'Game_Maker'))}
    src = np.load(WORK/'tile_index.npz')['src']
    ok = {i for i, s in enumerate(src) if s in terr}
    for k, lst in meta['dups'].items():
        if any(s in terr for s, _, _ in lst): ok.add(int(k))
    return ok

def export(name):
    g = json.load(open(WORK/'grid'/f'{name}.json'))
    gobj = json.load(open(WORK/'grid'/f'{name}_objects.json'))
    det = json.load(open(WORK/'detect'/f'{name}.json'))
    cat = {r['id']: r for r in json.load(open(WORK/'catalog.json'))}
    tt = tiles(); terr = terrain_tile_set()
    R, C = g['rows'], g['cols']
    cells_ = [[(v[:2] if v else None) for v in row] for row in g['cells']]
    ground = [['' for _ in range(C)] for _ in range(R)]
    for r in range(R):
        for c in range(C):
            v = g['cells'][r][c]
            if not v: continue
            # colour class everywhere; terrain-sheet origin recorded separately ('building' set below)
            ground[r][c] = ground_class(tt[v[0], ..., :3])
    objs = []
    for o in gobj:
        cls = sprite_class(o['name'], o['pack'])
        objs.append(dict(sid=o['id'], name=o['name'], pack=o['pack'], cls=cls, x=o['x'], y=o['y'],
                         w=o['tw'] * T, h=o['th'] * T, grid=True, conf='high'))
        if cls == 'building':
            for i in range(o['th']):
                for j in range(o['tw']):
                    r, c = o['r'] + i, o['c'] + j
                    if 0 <= r < R and 0 <= c < C: ground[r][c] = 'building'
    for o in det['objects']:
        objs.append(dict(sid=o['id'], name=o['name'], pack=o['pack'], cls=sprite_class(o['name'], o['pack']),
                         x=o['x'], y=o['y'], w=o['w'], h=o['h'], grid=False, frac=o['frac'],
                         conf='high' if o['frac'] >= 0.85 else 'low'))
    sc = dict(name=name, size=det['size'], phase=g['phase'], origin=g['origin'], cols=C, rows=R,
              cells=cells_, ground=ground, objects=objs)
    out = WORK/'scenes'; out.mkdir(exist_ok=True)
    json.dump(sc, open(out/f'{name}.json', 'w'))
    return sc

def render(sc, free_only_over_grid=True):
    """Render a scene to RGBA uint8: grid base -> overlay -> objects sorted by bottom edge."""
    W, H = sc['size']; tt = tiles()
    cat = {r['id']: r for r in json.load(open(WORK/'catalog.json'))}
    img = np.zeros((H, W, 4), np.uint8)
    ox, oy = sc['phase']; cx0, cy0 = sc['origin']
    def blit(src, x, y):
        h, w = src.shape[:2]
        x0, y0, x1, y1 = max(x, 0), max(y, 0), min(x + w, W), min(y + h, H)
        if x0 >= x1 or y0 >= y1: return
        s = src[y0 - y:y1 - y, x0 - x:x1 - x]
        m = s[..., 3:4] == 255
        img[y0:y1, x0:x1] = np.where(m, s, img[y0:y1, x0:x1])
    for r, row in enumerate(sc['cells']):
        for c, v in enumerate(row):
            if not v: continue
            x, y = ox + (cx0 + c) * T, oy + (cy0 + r) * T
            blit(tt[v[0]], x, y)
            if v[1] >= 0: blit(tt[v[1]], x, y)
    objs = sorted(sc['objects'], key=lambda o: (not o.get('grid'), o['y'] + o['h']))
    if not free_only_over_grid:
        objs = sorted(sc['objects'], key=lambda o: o['y'] + o['h'])
    for o in objs:
        if o.get('grid') and free_only_over_grid: continue   # already in the grid layer
        blit(load_rgba(ASSETS/cat[o['sid']]['file']), o['x'], o['y'])
    return img

def recon_check(name):
    sc = json.load(open(WORK/'scenes'/f'{name}.json'))
    a, _ = load_map(name)
    img = render(sc)
    ok = (img[..., 3] > 0) & (np.abs(img[..., :3].astype(int) - a[..., :3].astype(int)).max(-1) <= TOL)
    Image.fromarray(img).save(WORK/'scenes'/f'{name}_recon.png')
    diff = a[..., :3].copy(); diff[ok] = (diff[ok] * 0.3).astype(np.uint8)
    Image.fromarray(diff).resize((diff.shape[1] * 2, diff.shape[0] * 2), Image.NEAREST).save(WORK/'scenes'/f'{name}_diff.png')
    return float(ok.mean())

if __name__ == '__main__':
    cmd, names = sys.argv[1], sys.argv[2:] or ref_names()
    if cmd == 'export':
        for n in names:
            if not (WORK/'detect'/f'{n}.json').exists(): print('skip', n); continue
            sc = export(n)
            acc = recon_check(n)
            print(f"{n:36s} objects={len(sc['objects']):4d} reconstruction-match={acc:.3f}")
