"""Render a sheet region with a labelled 16px grid: sheet_grid.py <sheet substring> <c0> <r0> <c1> <r1> <out> [scale]"""
import sys
from PIL import Image, ImageDraw
from common import *
p = next(p for p in sheets() if sys.argv[1] in p.name)
c0, r0, c1, r1 = map(int, sys.argv[2:6]); S = int(sys.argv[7]) if len(sys.argv) > 7 else 3
im = Image.open(p).convert('RGBA').crop((c0 * T, r0 * T, c1 * T, r1 * T))
bg = Image.new('RGBA', im.size, (255, 0, 255, 255)); bg.alpha_composite(im)
bg = bg.resize((im.width * S, im.height * S), Image.NEAREST)
M = 18
out = Image.new('RGBA', (bg.width + M, bg.height + M), (255, 255, 255, 255)); out.paste(bg, (M, M))
dr = ImageDraw.Draw(out)
for c in range(c1 - c0 + 1):
    x = M + c * T * S; dr.line([(x, M), (x, out.height)], fill=(0, 255, 255, 255))
    if c < c1 - c0: dr.text((x + 2, 2), str(c0 + c), fill=(0, 0, 0))
for r in range(r1 - r0 + 1):
    y = M + r * T * S; dr.line([(M, y), (out.width, y)], fill=(0, 255, 255, 255))
    if r < r1 - r0: dr.text((1, y + 2), str(r0 + r), fill=(0, 0, 0))
out.save(sys.argv[6])
