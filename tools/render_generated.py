"""Render generator scenes (app scene JSON) to PNG with the same draw rules as the Phaser viewer.

  uv run python render_generated.py <scene.json ...> [--scale 2] [--grid] [--ghost]
Writes <scene>.png next to the json. Draw order: ground layers, then objects sorted by (foot, sub).
"""
import sys, json
from functools import lru_cache
from pathlib import Path
from PIL import Image, ImageDraw
from common import *

@lru_cache(maxsize=None)
def img(rel):
    return Image.open(ASSETS/rel).convert('RGBA')

@lru_cache(maxsize=None)
def tile(sheet_rel, c, r):
    return img(sheet_rel).crop((c * T, r * T, (c + 1) * T, (r + 1) * T))

def render(sc, grid=False, ghost=False):
    W, H = sc['cols'] * T, sc['rows'] * T
    out = Image.new('RGBA', (W, H), (0, 0, 0, 255))
    for layer in sc['ground']:
        for y, row in enumerate(layer):
            for x, t in enumerate(row):
                if t: out.alpha_composite(tile(sc['sheets'][t[0]], t[1], t[2]), (x * T, y * T))
    for o in sorted(sc['objects'], key=lambda o: (o['foot'], o.get('sub', 0))):
        if o['kind'] == 'sprite':
            im = img(o['file'])
            if o.get('flipX'): im = im.transpose(Image.FLIP_LEFT_RIGHT)
            cut = max(0, min(im.height, o['solid'] - o['y'])) if ghost and 'solid' in o else 0
            if cut:   # ghost view: the part above the building footprint drawn translucent
                top = im.crop((0, 0, im.width, cut)); a = top.getchannel('A').point(lambda v: int(v * 0.28)); top.putalpha(a)
                paste_clip(out, top, o['x'], o['y'])
                if cut < im.height: paste_clip(out, im.crop((0, cut, im.width, im.height)), o['x'], o['y'] + cut)
            else: paste_clip(out, im, o['x'], o['y'])
        else:
            c, r = o['frame']
            for l in o['layers']:
                fr = img(l).crop((c * 16, r * 32, c * 16 + 16, r * 32 + 32))
                paste_clip(out, fr, o['x'], o['y'])
    if grid:
        dr = ImageDraw.Draw(out)
        for x in range(0, W, T * 4): dr.line([(x, 0), (x, H)], fill=(255, 0, 255, 80))
        for y in range(0, H, T * 4): dr.line([(0, y), (W, y)], fill=(255, 0, 255, 80))
    return out

def paste_clip(out, im, x, y):
    x0, y0 = max(0, -x), max(0, -y)
    if x0 >= im.width or y0 >= im.height: return
    out.alpha_composite(im.crop((x0, y0, im.width, im.height)), (x + x0, y + y0))

if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    S = int(sys.argv[sys.argv.index('--scale') + 1]) if '--scale' in sys.argv else 2
    args = [a for a in args if not (a.isdigit() and '--scale' in sys.argv)]
    for p in args:
        sc = json.load(open(p))
        im = render(sc, '--grid' in sys.argv, '--ghost' in sys.argv)
        if S != 1: im = im.resize((im.width * S, im.height * S), Image.NEAREST)
        out = Path(p).with_suffix('.png') if '--ghost' not in sys.argv else Path(p).with_name(Path(p).stem + '_ghost.png')
        im.save(out); print(out, im.size)
