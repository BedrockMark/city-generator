"""Experiment: are props placed on the 16px grid? Match sprites of given packs at ANY pixel offset
in one reference and report offsets mod 16."""
import sys, json
import numpy as np, cv2
from collections import Counter
from common import *
ref, packs = sys.argv[1], sys.argv[2].split(',')
cat = json.load(open(WORK/'catalog.json'))
img = load_rgba(REFS/f'{ref}.png')[..., :3].astype(np.float32)
hits = []
for r in cat:
    if r['dup_of'] is not None or not any(r['pack'].startswith(p) for p in packs): continue
    s = load_rgba(ASSETS/r['file'])
    m = (s[..., 3] == 255)
    if m.sum() < 40 or s.shape[0] > img.shape[0] or s.shape[1] > img.shape[1]: continue
    tpl = s[..., :3].astype(np.float32)
    res = cv2.matchTemplate(img, tpl, cv2.TM_SQDIFF, mask=np.repeat(m[..., None], 3, 2).astype(np.float32))
    res /= (m.sum() * 3)
    ys, xs = np.nonzero(res < 30)
    for y, x in zip(ys, xs):
        hits.append((float(res[y, x]), r['name'], int(x), int(y), r['w'], r['h']))
hits.sort()
# non-max suppress: keep best per overlapping location
kept = []
for h in hits:
    if all(abs(h[2]-k[2]) >= 4 or abs(h[3]-k[3]) >= 4 for k in kept): kept.append(h)
for h in kept[:60]: print(f"{h[0]:6.1f} {h[1]:45s} x={h[2]:4d} y={h[3]:4d} mod16=({h[2]%16},{h[3]%16}) {h[4]}x{h[5]}")
print(Counter((h[2]%16, h[3]%16) for h in kept).most_common(10))
