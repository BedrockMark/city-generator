"""Crop a vertical band of a sheet, upscale x2, for eyeballing: sheet_crop.py <sheet substring> <y0> <y1> <out>"""
import sys
from PIL import Image
from common import *
p = next(p for p in sheets() if sys.argv[1] in p.name)
im = Image.open(p).convert('RGBA')
y0, y1 = int(sys.argv[2]), int(sys.argv[3])
c = im.crop((0, y0, im.width, min(y1, im.height)))
bg = Image.new('RGBA', c.size, (255, 0, 255, 255)); bg.alpha_composite(c)
bg.resize((c.width * 2, c.height * 2), Image.NEAREST).save(sys.argv[4])
