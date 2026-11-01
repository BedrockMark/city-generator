"""Detect character layers (outfits, accessories, kid outfits) in reference maps.

Characters are composites (body+eyes+outfit+hair+accessory), so we match the OUTFIT and ACCESSORY layers
independently as sprites (frames of rows preview/idle/walk/sit/sit_alt/phone/read), only on pixels that the
scene reconstruction (grid + objects) could not explain. Re-uses detect_objects.detect_sprite / resolve.

Output: work/characters/detect/<name>.json  [{layer, file, row, col, pose, x, y, frac, informative}]
        work/characters/detect/<name>_overlay.png
Usage: uv run python detect_characters.py [names...]
"""
import sys, json, hashlib
import numpy as np
from multiprocessing import Pool
from PIL import Image, ImageDraw
from common import *
import detect_objects as D
from characters import ROWS, FW, FH, load_layer, layer_files

OUT = WORK/'characters'/'detect'
USE_ROWS = {0: 'preview', 1: 'idle', 2: 'walk', 4: 'sit', 5: 'sit_alt', 6: 'phone', 7: 'read'}
_t = None

def templates():
    global _t
    if _t is not None: return _t
    cats = layer_files()
    _t, seen = [], set()
    for layer in ('Outfits', 'Outfits_kids', 'Accessories'):
        for f in cats[layer]:
            a = load_layer(f)
            for row, pose in USE_ROWS.items():
                if (row + 1) * FH > a.shape[0]: continue
                for col in range(a.shape[1] // FW):
                    fr = a[row * FH:(row + 1) * FH, col * FW:(col + 1) * FW]
                    m = fr[..., 3] == 255
                    if m.sum() < 30: continue
                    h = hashlib.md5(fr.tobytes()).hexdigest()
                    if h in seen: continue
                    seen.add(h)
                    r = dict(id=f'{f}#{row}:{col}', name=f.split('/')[-1][:-4], pack=layer)
                    _t.append((r, m, fr[..., :3].astype(np.float32) - 128, pose, row, col))
    return _t

def run(name):
    a, _ = load_map(name)
    rec = load_rgba(WORK/'scenes'/f'{name}_recon.png')
    G = (rec[..., 3] > 0) & (np.abs(rec[..., :3].astype(int) - a[..., :3].astype(int)).max(-1) <= D.TOL)
    I = a[..., :3].astype(np.float32) - 128
    Mi = np.ones(a.shape[:2], np.float32); I2 = (I ** 2).sum(-1)
    dets = []
    for r, m, T_, pose, row, col in templates():
        for d in D.detect_sprite(I, Mi, I2, r, m, T_, G):
            if d['frac'] < 0.75: continue
            d.update(pose=pose, row=row, col=col); dets.append(d)
    # resolve separately per layer kind: outfits vs accessories may overlap the same person
    kept = []
    for kind in (('Outfits', 'Outfits_kids'), ('Accessories',)):
        k, _ = D.resolve([d for d in dets if d['pack'] in kind], a.shape[:2])
        kept += k
    for d in kept: d.pop('_good', None)
    OUT.mkdir(parents=True, exist_ok=True)
    json.dump(kept, open(OUT/f'{name}.json', 'w'), indent=0)
    S = 3
    im = Image.fromarray(a[..., :3]).resize((a.shape[1] * S, a.shape[0] * S), Image.NEAREST)
    dr = ImageDraw.Draw(im)
    for d in kept:
        col = (0, 255, 255) if d['pack'] != 'Accessories' else (255, 255, 0)
        dr.rectangle([d['x'] * S, d['y'] * S, (d['x'] + d['w']) * S - 1, (d['y'] + d['h']) * S - 1], outline=col)
        dr.text((d['x'] * S, d['y'] * S - 10), f"{d['name'].replace('Outfit_', 'O').replace('Accessory_', 'A')[:14]} {d['pose']}", fill=col)
    im.save(OUT/f'{name}_overlay.png')
    no = sum(d['pack'] != 'Accessories' for d in kept)
    return f"{name:36s} outfits={no:3d} accessories={len(kept) - no:3d}"

if __name__ == '__main__':
    names = sys.argv[1:] or ref_names()
    print('templates', len(templates()), flush=True)
    if len(names) == 1: print(run(names[0]))
    else:
        with Pool(12) as p:
            for line in p.imap_unordered(run, names): print(line, flush=True)
