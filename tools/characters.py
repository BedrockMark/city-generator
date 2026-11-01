"""Character layer catalog + compositor (assets/charactors).

Sheets: 16x32 frames on a 56-column grid, row k at y = 32k (adult: 20 rows, kid: 4 rows).
Layer order (CHARACTER_GENERATOR.txt): body -> eyes -> outfit -> hairstyle -> accessory.
Exception: Outfit_kid_6_pajama_frog / Outfit_kid_7_pajama_tiger need no hairstyle.
'PG_*' files (320x96) are the separate portrait set -> ignored for map sprites.

Adult rows: 0 preview(R,U,L,D) 1 idle 2 walk 3 sleep 4 sit 5 sit(alt) 6 phone 7 read 8 push_cart 9 pick_up
            10 gift 11 lift 12 throw 13 hit 14 punch 15 stab 16 grab_gun 17 gun_idle 18 shoot 19 hurt
idle/walk: 6 frames per direction, direction blocks in order right, up, left, down.

Usage:
  uv run python characters.py catalog          -> work/characters/catalog.json
  uv run python characters.py contact          -> work/characters/contact_*.png (for theme tagging)
  uv run python characters.py random N [seed]  -> work/characters/random_<seed>.png (N random previews)
"""
import sys, json, re, random
import numpy as np
from PIL import Image, ImageDraw
from common import *

CH = ASSETS/'charactors'
OUT = WORK/'characters'
FW, FH = 16, 32
ROWS = ['preview', 'idle', 'walk', 'sleep', 'sit', 'sit_alt', 'phone', 'read', 'push_cart', 'pick_up', 'gift', 'lift',
        'throw', 'hit', 'punch', 'stab', 'grab_gun', 'gun_idle', 'shoot', 'hurt']
DIRS = ['right', 'up', 'left', 'down']
NO_HAIR_OUTFITS = ('Outfit_kid_6_pajama_frog', 'Outfit_kid_7_pajama_tiger')

def layer_files():
    cats = {}
    for d in ['Bodies', 'Eyes', 'Outfits', 'Hairstyles', 'Accessories', 'Bodies_kids', 'Eyes_kids', 'Outfits_kids',
              'Hairstyles_kids', 'Books', 'Smartphones']:
        fs = sorted(p for p in (CH/d).glob('*.png') if not p.name.startswith('PG_'))
        fs = [p for p in fs if Image.open(p).size[0] >= 384]   # drop portrait-size / stray files
        cats[d] = [p.relative_to(ASSETS).as_posix() for p in fs]
    return cats

def load_layer(rel):
    a = load_rgba(ASSETS/rel)
    return a[:, :56 * FW] if a.shape[1] > 56 * FW else a     # strip burned-in labels on the right

def compose(layers):
    """layers: list of asset-relative paths in draw order -> RGBA sheet (H,W,4)."""
    arrs = [load_layer(l) for l in layers if l]
    H = min(a.shape[0] for a in arrs); W = min(a.shape[1] for a in arrs)
    out = np.zeros((H, W, 4), np.uint8)
    for a in arrs:
        a = a[:H, :W]
        m = a[..., 3:4] > 0
        out = np.where(m, a, out)
    return out

def frame(sheet, row, col):
    return sheet[row * FH:(row + 1) * FH, col * FW:(col + 1) * FW]

def pose(sheet, name='idle', direction='down', i=0):
    """single frame: idle/walk use 6 frames per direction; preview has one per direction."""
    row = ROWS.index(name)
    if name == 'preview': return frame(sheet, 0, DIRS.index(direction))
    if name in ('idle', 'walk'): return frame(sheet, row, DIRS.index(direction) * 6 + i)
    return frame(sheet, row, i)

def random_character(rng, cats, kid=None, tags=None):
    kid = rng.random() < 0.15 if kid is None else kid
    s = '_kids' if kid else ''
    body = rng.choice(cats['Bodies' + s]); eyes = rng.choice(cats['Eyes' + s])
    outfit = rng.choice(cats['Outfits' + s])
    hair = None if any(k in outfit for k in NO_HAIR_OUTFITS) else rng.choice(cats['Hairstyles' + s])
    acc = rng.choice(cats['Accessories']) if (not kid and rng.random() < 0.3) else None
    return [body, eyes, outfit, hair, acc]

def contact(files, base, out, cols=20, label_every=True, S=3, start=0):
    n = len(files); rows = -(-n // cols)
    im = Image.new('RGBA', (cols * (FW * S + 6), rows * (FH * S + 14)), (120, 120, 130, 255))
    dr = ImageDraw.Draw(im)
    for k, f in enumerate(files):
        sh = compose(base + [f])
        fr = Image.fromarray(pose(sh, 'preview', 'down')).resize((FW * S, FH * S), Image.NEAREST)
        x, y = (k % cols) * (FW * S + 6), (k // cols) * (FH * S + 14)
        im.alpha_composite(fr, (x + 3, y + 12))
        dr.text((x + 2, y), str(k + start), fill=(255, 255, 0))
    im.save(out)

if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    cats = layer_files()
    cmd = sys.argv[1]
    if cmd == 'catalog':
        json.dump(cats, open(OUT/'catalog.json', 'w'), indent=1)
        for k, v in cats.items(): print(k, len(v))
    elif cmd == 'contact':
        body, eyes = cats['Bodies'][0], cats['Eyes'][0]
        contact(cats['Outfits'], [body, eyes], OUT/'contact_outfits.png')
        contact(cats['Accessories'], [body, eyes, cats['Outfits'][0]], OUT/'contact_accessories.png')
        contact(cats['Hairstyles'][::5], [body, eyes, cats['Outfits'][0]], OUT/'contact_hair_every5.png')
        contact(cats['Outfits_kids'], [cats['Bodies_kids'][0], cats['Eyes_kids'][0]], OUT/'contact_outfits_kids.png', cols=8)
        contact(cats['Bodies'], [], OUT/'contact_bodies.png', cols=12)
        for h in range(0, len(cats['Outfits']), 70):
            contact(cats['Outfits'][h:h + 70], [body, eyes], OUT/f'contact_outfits_big_{h}.png', cols=14, S=5, start=h)
        json.dump(cats, open(OUT/'catalog.json', 'w'), indent=1)
        print('ok')
    elif cmd == 'random':
        n = int(sys.argv[2]); seed = int(sys.argv[3]) if len(sys.argv) > 3 else 0
        rng = random.Random(seed)
        frames = [Image.fromarray(pose(compose(random_character(rng, cats)), 'idle', 'down')) for _ in range(n)]
        im = Image.new('RGBA', (n * 18, 34), (120, 120, 130, 255))
        for k, f in enumerate(frames): im.alpha_composite(f, (k * 18 + 1, 1))
        im.resize((im.width * 3, im.height * 3), Image.NEAREST).save(OUT/f'random_{seed}.png')
        print('ok')
