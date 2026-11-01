"""Shared helpers for the analysis scripts."""
from pathlib import Path
import numpy as np
from PIL import Image
ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT/'assets'
WORK = ROOT/'work'
REFS = WORK/'refs'
T = 16

def load_rgba(p):
    return np.asarray(Image.open(p).convert('RGBA'))

def sheets():
    """All combined sheets (not the Singles folders)."""
    out = []
    for p in sorted(ASSETS.rglob('*.png')):
        if 'Singles' in p.parent.name: continue
        if 'Godot' in p.name: continue   # duplicate of GMS autotiles
        out.append(p)
    return out

def singles():
    return sorted(p for p in ASSETS.rglob('*.png') if 'Singles' in p.parent.name)

def cells(a, ox=0, oy=0):
    """Yield (cx, cy, tile) for full 16x16 cells of array a with phase (ox,oy)."""
    h, w = a.shape[:2]
    for cy in range((h-oy)//T):
        for cx in range((w-ox)//T):
            y, x = oy+cy*T, ox+cx*T
            yield cx, cy, a[y:y+T, x:x+T]

import json as _json
META = _json.load(open(Path(__file__).resolve().parent/'refs_meta.json', encoding='utf-8'))
FRAME = 4  # px of UI frame to drop when roi is null

def load_map(name):
    """Native-res RGB(A) crop of the actual map region of a reference, plus (x0,y0) offset."""
    a = load_rgba(REFS/f'{name}.png')
    roi = META.get(name, {}).get('roi')
    if roi is None:
        roi = [FRAME, FRAME, a.shape[1]-FRAME, a.shape[0]-FRAME]
    x0, y0, x1, y1 = roi
    return a[y0:y1, x0:x1], (x0, y0)

def ref_names(kinds=('street', 'site', 'showcase')):
    return [k for k, v in META.items() if not k.startswith('_') and v['kind'] in kinds]
