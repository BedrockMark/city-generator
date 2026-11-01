"""Which sheet tiles do references use, and where? (to learn the ground tile grammar)

  uv run python tile_usage.py grid <ref> [x0 y0 x1 y1]   -> prints the cell grid as short codes + legend
  uv run python tile_usage.py atlas <out.png> <refs...>   -> labelled atlas of the tiles used (by frequency)

Codes: each distinct (base,overlay) gets a 2-char code; legend gives sheet:col,row for base and overlay.
"""
import sys, json
import numpy as np
from collections import Counter
from PIL import Image, ImageDraw
from common import *

d = np.load(WORK/'tile_index.npz'); TILES, SRC, POS = d['tiles'], d['src'], d['pos']
META_T = json.load(open(WORK/'tile_index.json'))
SHEETS = [s.split('/')[-1].replace('_16x16.png', '') for s in META_T['sheets']]

def tname(tid):
    if tid < 0: return '-'
    return f"{SHEETS[SRC[tid]]}:{POS[tid][0]},{POS[tid][1]}"

def grid(ref, box=None):
    g = json.load(open(WORK/'grid'/f'{ref}.json'))
    cells = g['cells']
    R, C = g['rows'], g['cols']
    r0, c0, r1, c1 = (0, 0, R, C) if box is None else (box[1], box[0], box[3], box[2])
    codes, legend = {}, []
    alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    lines = []
    for r in range(r0, min(r1, R)):
        line = []
        for c in range(c0, min(c1, C)):
            v = cells[r][c]
            if not v: line.append('..'); continue
            k = (v[0], v[1])
            if k not in codes:
                i = len(codes); codes[k] = alpha[i % len(alpha)] + alpha[(i // len(alpha)) % len(alpha)]
                legend.append((codes[k], tname(v[0]), tname(v[1])))
            line.append(codes[k])
        lines.append(' '.join(line))
    print('\n'.join(lines)); print()
    for code, b, o in legend: print(f'{code}: base={b:40s} over={o}')

def atlas(out, refs, top=400):
    cnt = Counter()
    for ref in refs:
        g = json.load(open(WORK/'grid'/f'{ref}.json'))
        for row in g['cells']:
            for v in row:
                if v: cnt[v[0]] += 1; cnt[v[1]] += 1 if v[1] >= 0 else 0
    cnt.pop(-1, None)
    items = cnt.most_common(top)
    S, cols = 3, 16
    cw, chh = T * S + 4, T * S + 26
    im = Image.new('RGBA', (cols * cw, -(-len(items) // cols) * chh), (255, 0, 255, 255))
    dr = ImageDraw.Draw(im)
    for i, (tid, n) in enumerate(items):
        x, y = (i % cols) * cw, (i // cols) * chh
        t = Image.fromarray(TILES[tid]).resize((T * S, T * S), Image.NEAREST)
        im.alpha_composite(t, (x + 2, y + 2))
        sh = SHEETS[SRC[tid]][:6]
        dr.text((x + 1, y + T * S + 2), f"{sh}{POS[tid][0]},{POS[tid][1]}", fill=(0, 0, 0))
        dr.text((x + 1, y + T * S + 12), f"#{tid} n{n}", fill=(0, 0, 0))
    im.save(out)

if __name__ == '__main__':
    if sys.argv[1] == 'grid':
        grid(sys.argv[2], [int(v) for v in sys.argv[3:7]] if len(sys.argv) > 6 else None)
    else:
        atlas(sys.argv[2], sys.argv[3:])
