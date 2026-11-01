"""Contact sheet of catalog singles whose name matches a regex: singles_contact.py <regex> <out> [pack substring] [scale]"""
import sys, re, json
from PIL import Image, ImageDraw
from common import *
rx = re.compile(sys.argv[1]); pk = sys.argv[3] if len(sys.argv) > 3 else ''; S = int(sys.argv[4]) if len(sys.argv) > 4 else 2
cat = [r for r in json.load(open(WORK/'catalog.json')) if rx.search(r['name']) and pk in r['pack'] and r['dup_of'] is None]
cat.sort(key=lambda r: (r['base'], r['variant'] or 0))
W = 1400; x = y = 0; rowh = 0; placed = []
for r in cat:
    w, h = r['w'] * S + 8, r['h'] * S + 14
    if x + w > W: x = 0; y += rowh; rowh = 0
    placed.append((r, x, y)); x += w; rowh = max(rowh, h)
im = Image.new('RGBA', (W, y + rowh), (90, 90, 100, 255)); dr = ImageDraw.Draw(im)
for r, x, y in placed:
    s = Image.open(ASSETS/r['file']).convert('RGBA'); s = s.resize((s.width * S, s.height * S), Image.NEAREST)
    im.alpha_composite(s, (x + 4, y + 12)); dr.text((x + 2, y), f"{r['id']}:{r['name'][-18:]}", fill=(255, 255, 0))
im.save(sys.argv[2]); print(len(cat))
