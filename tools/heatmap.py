"""Stage 6 judge heat map: oddness score per window over the map.

  uv run python heatmap.py <name>.heat.json <out.png>
heat.json (written by app/scripts/judge.ts): {src: 'gen' | 'ref', scene?: <scene.json path>, ref?: <reference name>,
  threshold, windows: [{rect: {x0,y0,x1,y1}, score}]}. Each pixel takes the highest score of the windows covering it,
  shown from transparent to red (alpha = 0.6 * score); windows above the threshold get an outline. Output at 2x.
"""
import sys, json
import numpy as np
from PIL import Image, ImageDraw
from common import *
from render_generated import render

def main(src, out):
    h = json.load(open(src, encoding='utf-8'))
    if h['src'] == 'gen': base = render(json.load(open(h['scene'], encoding='utf-8')))
    else: base = Image.fromarray(load_map(h['ref'])[0]).convert('RGBA')
    W, H = base.size
    heat = np.zeros((H, W), np.float32)
    for w in h['windows']:
        r = w['rect']
        x0, y0, x1, y1 = max(0, r['x0']), max(0, r['y0']), min(W, r['x1']), min(H, r['y1'])
        if x1 > x0 and y1 > y0: heat[y0:y1, x0:x1] = np.maximum(heat[y0:y1, x0:x1], w['score'])
    ov = np.zeros((H, W, 4), np.uint8)
    ov[..., 0] = 230; ov[..., 1] = 30; ov[..., 2] = 30; ov[..., 3] = (heat * 0.6 * 255).astype(np.uint8)
    im = Image.alpha_composite(base, Image.fromarray(ov, 'RGBA'))
    im = im.resize((W * 2, H * 2), Image.NEAREST)
    d = ImageDraw.Draw(im)
    for w in h['windows']:
        if w['score'] > h['threshold']:
            r = w['rect']; d.rectangle([r['x0'] * 2, r['y0'] * 2, r['x1'] * 2 - 1, r['y1'] * 2 - 1], outline=(255, 235, 59, 255), width=2)
    im.convert('RGB').save(out)
    print(f'{out}: {len(h["windows"])} windows, {sum(w["score"] > h["threshold"] for w in h["windows"])} above threshold')

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
