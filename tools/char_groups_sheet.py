"""One representative per outfit group, front+side idle, x6, labelled with group name."""
import json
from PIL import Image, ImageDraw
from common import *
from characters import compose, pose, layer_files
cats = layer_files()
groups = {}
for f in cats['Outfits']:
    n = f.split('/')[-1][:-4]; k = '_'.join(n.split('_')[:2])
    groups.setdefault(k, f)
S, cols = 5, 10
items = list(groups.items())
im = Image.new('RGBA', (cols * 190, -(-len(items) // cols) * 190), (110, 110, 120, 255))
dr = ImageDraw.Draw(im)
for i, (k, f) in enumerate(items):
    sh = compose([cats['Bodies'][2], cats['Eyes'][0], f, cats['Hairstyles'][40]])
    x, y = (i % cols) * 190, (i // cols) * 190
    for j, d in enumerate(('down', 'right')):
        fr = Image.fromarray(pose(sh, 'idle', d)).resize((16 * S, 32 * S), Image.NEAREST)
        im.alpha_composite(fr, (x + 5 + j * 85, y + 20))
    dr.text((x + 4, y + 4), k.replace('Outfit_', ''), fill=(255, 255, 0))
im.save(WORK/'characters'/'outfit_groups.png')
