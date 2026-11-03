"""Before / after crops of labelled spots (stage 5 reports).

  cd work/<shots dir> && uv run python ../../tools/compare_crops.py <version> <out dir>
expects off/citygen_v<version>_seed<S>_p0.png (no pruning) and pd/citygen_v<version>_seed<S>_pd1.png (draft repairs),
both exported at 2x by app/scripts/shots.ts; crops every bad label in references/labels/v*/ around its rect.
"""
import json, glob, sys
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
VERSION, OUT = sys.argv[1], Path(sys.argv[2])

def load(seed, mode):
    f = f'off/citygen_v{VERSION}_seed{seed}_p0.png' if mode == 'off' else f'pd/citygen_v{VERSION}_seed{seed}_pd1.png'
    return Image.open(f).convert('RGB')

def pair(seed, r, M, title):
    A, B = load(seed, 'off'), load(seed, 'pd'); S = 2
    box = ((r[0] - M) * S, (r[1] - M) * S, (r[2] + M) * S, (r[3] + M) * S)
    a = A.crop(box); b = B.crop(box); w, h = a.size
    out = Image.new('RGB', (w * 2 + 8, h + 18), (0, 0, 0)); out.paste(a, (0, 18)); out.paste(b, (w + 8, 18))
    d = ImageDraw.Draw(out); d.text((4, 3), title, fill=(255, 255, 0)); d.text((w + 12, 3), 'after (draft repairs)', fill=(120, 255, 160))
    for x in (0, w + 8): d.rectangle([x + M * S, 18 + M * S, x + (r[2] - r[0] + M) * S, 18 + (r[3] - r[1] + M) * S], outline=(255, 40, 40), width=2)
    return out

def sheet(items, name, cols=2):
    W = max(p.width for p in items); rows = [items[i:i + cols] for i in range(0, len(items), cols)]
    H = sum(max(p.height for p in r) + 6 for r in rows); im = Image.new('RGB', (W * cols + 6 * (cols - 1), H), (30, 30, 30)); y = 0
    for r in rows:
        x = 0
        for p in r: im.paste(p, (x, y)); x += W + 6
        y += max(p.height for p in r) + 6
    im.save(OUT / f'{name}.png'); print(name, im.size)

items = []
for f in sorted(glob.glob(str(ROOT / 'references/labels/v*/seed*.json'))):
    if f.endswith('.scene.json'): continue
    seed = Path(f).stem[4:]
    try: load(seed, 'off'); load(seed, 'pd')
    except FileNotFoundError: continue
    for l in json.load(open(f, encoding='utf8'))['labels']:
        if l['verdict'] != 'bad': continue
        t = l['target']['rect']; items.append(pair(seed, (t['x0'], t['y0'], t['x1'], t['y1']), 72, f"{seed} {l['id']} before"))
sheet(items, 'labels_before_after')
sheet([pair('8', (304, 544, 320, 640), 64, '8 alley (C03) before'), pair('33', (496, 520, 592, 600), 40, '33 plaza (C02) before')], 'c03_c02')
