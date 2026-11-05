"""Crop one region of a generator scene (stage 7 gaps report): full render with render_generated.render (nothing written
next to the json), crop the region plus padding, red box around the region, 2x nearest.

  uv run python crop_region.py <scene.json> <x0> <y0> <x1> <y1> <out.png> [--pad 32]
"""
import sys, json
from pathlib import Path
from PIL import Image, ImageDraw
from render_generated import render

if __name__ == '__main__':
    pad = int(sys.argv[sys.argv.index('--pad') + 1]) if '--pad' in sys.argv else 32
    args = [a for i, a in enumerate(sys.argv[1:], 1) if a != '--pad' and sys.argv[i - 1] != '--pad']
    p, x0, y0, x1, y1, out = args[0], *map(int, args[1:5]), args[5]
    im = render(json.load(open(p, encoding='utf-8')))
    cx0, cy0, cx1, cy1 = max(0, x0 - pad), max(0, y0 - pad), min(im.width, x1 + pad), min(im.height, y1 + pad)
    c = im.crop((cx0, cy0, cx1, cy1))
    ImageDraw.Draw(c).rectangle([x0 - cx0, y0 - cy0, x1 - cx0 - 1, y1 - cy0 - 1], outline=(255, 0, 0, 255))
    c = c.resize((c.width * 2, c.height * 2), Image.NEAREST)
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    c.save(out); print(out, c.size)
