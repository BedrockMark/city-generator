"""Before / after of 整体修图 (exp-02, v0.6.1): the whole map side by side (stage 6 report).

  uv run python compare_repair.py <out.png> <before.json> <after.json> [<before.json> <after.json> ...]
before = scene with exp-02 off, after = the same seed with 整体修图 on (its judgeRepair record gives the scores).
Each row: before | after, titled with seed, the adopted re-pack and the map mean before -> after.
"""
import json, sys
from PIL import Image, ImageDraw
from render_generated import render

def row(before, after):
    a, b = render(before).convert('RGB'), render(after).convert('RGB')
    r = after.get('judgeRepair') or {}
    did = f"re-pack {r['globalAdopted']}" if r.get('globalAdopted') is not None else 'kept the original'
    w, h = a.width, max(a.height, b.height)
    im = Image.new('RGB', (a.width + b.width + 8, h + 18), (0, 0, 0)); im.paste(a, (0, 18)); im.paste(b, (w + 8, 18))
    d = ImageDraw.Draw(im)
    d.text((4, 3), f"seed {after['seed']}  before (exp-02 off)", fill=(255, 255, 0))
    d.text((w + 12, 3), f"after: {did}  mean {r.get('meanBefore', 0):.3f} -> {r.get('meanAfter', 0):.3f}", fill=(120, 255, 160))
    return im

def main(out, files):
    items = [row(json.load(open(files[i], encoding='utf-8')), json.load(open(files[i + 1], encoding='utf-8'))) for i in range(0, len(files), 2)]
    W = max(p.width for p in items); H = sum(p.height + 6 for p in items)
    sheet = Image.new('RGB', (W, H), (30, 30, 30)); y = 0
    for p in items: sheet.paste(p, (0, y)); y += p.height + 6
    sheet.save(out); print(f'{out}: {len(items)} maps')

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2:])
