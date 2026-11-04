"""Before / after crops of the windows the judge repair (exp-02) worked on (stage 6 report).

  uv run python compare_repair.py <out.png> <before.json> <after.json> [<before.json> <after.json> ...]
before = scene with exp-02 off, after = the repaired scene (its judgeRepair record says which windows). Each row:
before | after around one repaired window (red box), titled with seed, what was done and the score before -> after.
"""
import json, sys
from PIL import Image, ImageDraw
from render_generated import render

S, M = 2, 24   # scale, margin px around the window

def rows(before, after):
    A, B = render(before).convert('RGB'), render(after).convert('RGB')
    out = []
    for w in after.get('judgeRepair', {}).get('windows', []):
        did = f"salt {w['adopted']}" if w.get('adopted') is not None else 'downgrade' if isinstance(w.get('degraded'), dict) else None
        if not did: continue
        r = w['rect']; box = (max(0, r['x0'] - M), max(0, r['y0'] - M), min(A.width, r['x1'] + M), min(A.height, r['y1'] + M))
        a, b = A.crop(box).resize(((box[2] - box[0]) * S, (box[3] - box[1]) * S), Image.NEAREST), B.crop(box).resize(((box[2] - box[0]) * S, (box[3] - box[1]) * S), Image.NEAREST)
        w_, h_ = a.size; im = Image.new('RGB', (w_ * 2 + 8, h_ + 18), (0, 0, 0)); im.paste(a, (0, 18)); im.paste(b, (w_ + 8, 18))
        d = ImageDraw.Draw(im)
        d.text((4, 3), f"seed {after['seed']}  before (exp-02 off)", fill=(255, 255, 0))
        d.text((w_ + 12, 3), f"after: {did}  {w['why']}  {w['before']:.2f} -> {w['after']:.2f}", fill=(120, 255, 160))
        for x in (0, w_ + 8): d.rectangle([x + (r['x0'] - box[0]) * S, 18 + (r['y0'] - box[1]) * S, x + (r['x1'] - box[0]) * S - 1, 18 + (r['y1'] - box[1]) * S - 1], outline=(255, 40, 40), width=2)
        out.append(im)
    return out

def main(out, files):
    items = []
    for i in range(0, len(files), 2):
        items += rows(json.load(open(files[i], encoding='utf-8')), json.load(open(files[i + 1], encoding='utf-8')))
    W = max(p.width for p in items); H = sum(p.height + 6 for p in items)
    sheet = Image.new('RGB', (W, H), (30, 30, 30)); y = 0
    for p in items: sheet.paste(p, (0, y)); y += p.height + 6
    sheet.save(out); print(f'{out}: {len(items)} windows')

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2:])
