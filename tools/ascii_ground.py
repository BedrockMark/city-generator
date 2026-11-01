"""Print a scene's per-cell ground classes as ASCII (R=road .=paved B=building g=grass ~=water s=sand d=dirt ?=other blank=unknown)."""
import sys, json
from common import *
SYM = {'road': 'R', 'paved': '.', 'building': 'B', 'grass': 'g', 'water': '~', 'sand': 's', 'dirt': 'd', 'other': '?', '': ' '}
for n in sys.argv[1:]:
    sc = json.load(open(WORK/'scenes'/f'{n}.json'))
    print(n)
    for row in sc['ground']: print('  ' + ''.join(SYM.get(c, '?') for c in row))
