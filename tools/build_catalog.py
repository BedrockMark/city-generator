"""Catalog every Singles sprite: pack, base name, variant, size, opaque bbox, dedupe.
Writes work/catalog.json (list of dicts) and work/catalog.csv for browsing."""
import json, re, hashlib, csv
import numpy as np
from common import *
PREFIX = re.compile(r'^(ME_Singles_)?(?P<pack>.*?)_16x16_?')
rows, seen = [], {}
for p in singles():
    a = load_rgba(p)
    pack = p.parent.name.replace('_Singles_16x16', '')
    stem = p.stem.replace('_16x16', '')
    name = re.sub(r'^(ME_Singles_)?', '', stem)
    name = name.replace(re.sub(r'^\d+_', '', pack) + '_', '', 1).strip(' _')
    m = re.match(r'^(.*?)(?:_(\d+))?$', name)
    base, var = m.group(1), m.group(2)
    al = a[..., 3] > 0
    ys, xs = np.nonzero(al)
    bbox = [int(xs.min()), int(ys.min()), int(xs.max())+1, int(ys.max())+1] if len(xs) else [0, 0, 0, 0]
    h = hashlib.md5(a.tobytes()).hexdigest()
    dup_of = seen.get(h)
    if dup_of is None: seen[h] = len(rows)
    rows.append(dict(id=len(rows), file=p.relative_to(ASSETS).as_posix(), pack=pack, name=name, base=base,
                     variant=int(var) if var else None, w=a.shape[1], h=a.shape[0],
                     tw=-(-a.shape[1]//T), th=-(-a.shape[0]//T), opaque=int(al.sum()), bbox=bbox,
                     aligned=(a.shape[0] % T == 0 and a.shape[1] % T == 0), dup_of=dup_of))
json.dump(rows, open(WORK/'catalog.json', 'w'))
with open(WORK/'catalog.csv', 'w', newline='', encoding='utf-8') as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
u = [r for r in rows if r['dup_of'] is None]
print(f"{len(rows)} singles, {len(u)} unique, {sum(not r['aligned'] for r in rows)} not 16-aligned")
from collections import Counter
print(Counter((r['tw'], r['th']) for r in u).most_common(25))
