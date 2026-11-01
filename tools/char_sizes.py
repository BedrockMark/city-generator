"""Sizes of character layer sheets per folder."""
from collections import Counter
from PIL import Image
from common import *
c = Counter()
for p in (ASSETS/'charactors').rglob('*.png'):
    c[(p.parent.name, Image.open(p).size)] += 1
for k, v in sorted(c.items()): print(k, v)
