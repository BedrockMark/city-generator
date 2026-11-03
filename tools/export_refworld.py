"""Reference scenes -> compact 'world' JSON for the constraint checker (app/scripts/refcheck.ts).

  uv run python export_refworld.py            -> work/refworld/<name>.json for every street reference

Each file: {name, size:[W,H], phase:[ox,oy], origin:[cx0,cy0], ground: rows x cols class strings,
            objects: [{key, cls, conf, x, y, w, h, bb:[x0,y0,x1,y1] absolute opaque bbox}]}
Cell (r, c) covers px x in [ox + (c + cx0) * 16, +16), same for y (see stats.cell_of).
"""
import json
from common import *

META = json.load(open(Path(__file__).parent / 'refs_meta.json'))

def main():
    cat = {r['id']: r for r in json.load(open(WORK / 'catalog.json'))}
    out = WORK / 'refworld'; out.mkdir(exist_ok=True)
    n = 0
    for name, m in META.items():
        if not isinstance(m, dict) or m.get('kind') != 'street': continue
        p = WORK / 'scenes' / f'{name}.json'
        if not p.exists(): continue
        sc = json.load(open(p))
        objs = []
        for o in sc['objects']:
            c = cat[o['sid']]; bx0, by0, bx1, by1 = c['bbox']
            objs.append(dict(key=f"{o['pack']}/{o['name']}", cls=o['cls'], conf=o.get('conf', 'high'), x=o['x'], y=o['y'], w=o['w'], h=o['h'],
                             bb=[o['x'] + bx0, o['y'] + by0, o['x'] + bx1, o['y'] + by1]))
        json.dump(dict(name=name, size=sc['size'], phase=sc['phase'], origin=sc['origin'], ground=sc['ground'], objects=objs),
                  open(out / f'{name}.json', 'w'))
        n += 1
    print(f'{n} reference worlds -> {out}')

if __name__ == '__main__':
    main()
