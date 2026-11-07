"""Side-by-side crops of exp-07 repairs (work/deadend/pair.mts output): off | on, red box = the repair.
  uv run python deadend_pairs.py <dir> [--pad 64]"""
import sys, json
from pathlib import Path
from PIL import Image, ImageDraw
from render_generated import render
d = Path(sys.argv[1]); pad = int(sys.argv[sys.argv.index('--pad') + 1]) if '--pad' in sys.argv else 64
for rf in sorted(d.glob('*.rects.json')):
    seed = rf.name.split('.')[0]
    rs = json.load(open(rf, encoding='utf-8'))
    if not rs: continue
    a = render(json.load(open(d / f'{seed}.off.json', encoding='utf-8')))
    b = render(json.load(open(d / f'{seed}.on.json', encoding='utf-8')))
    for i, r in enumerate(rs):
        q = r['rect']; x0, y0 = max(0, q['x0'] - pad), max(0, q['y0'] - pad); x1, y1 = min(a.width, q['x1'] + pad), min(a.height, q['y1'] + pad)
        ca, cb = a.crop((x0, y0, x1, y1)), b.crop((x0, y0, x1, y1))
        ImageDraw.Draw(cb).rectangle([q['x0'] - x0, q['y0'] - y0, q['x1'] - x0 - 1, q['y1'] - y0 - 1], outline=(255, 0, 0, 255))
        im = Image.new('RGBA', (ca.width * 2 + 8, ca.height), (255, 255, 255, 255)); im.paste(ca, (0, 0)); im.paste(cb, (ca.width + 8, 0))
        im = im.resize((im.width * 2, im.height * 2), Image.NEAREST)
        im.convert('RGB').save(d / f'{seed}_{i}.png')
        print(d / f'{seed}_{i}.png', r['msg'])
