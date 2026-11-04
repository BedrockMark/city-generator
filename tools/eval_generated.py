"""Evaluate generator scenes (app scene JSON) against the references.

  uv run python eval_generated.py <scene.json ...> [--out report.md]

Per scene:
  * copy check vs all references (tile 4x4 windows, object constellations)  -> novelty.py logic
  * self repetition: object constellations repeated inside the scene (refs 0-0.087)
  * main-block density: placed things per 100 cells of main block (walk + lot), people per 100 cells
  * emptiness: largest connected patch of open ground cells (sidewalk / yard / plaza) with nothing within
    1 cell (no object footprint, no building) (the "big blank sidewalk" failure mode)
Across scenes: pairwise shared object constellations between seeds (diversity).
Reference calibration of emptiness is computed on ref scenes ('paved' cells) with the same rule.
"""
import sys, json
from collections import Counter, defaultdict
from functools import lru_cache
import numpy as np
from scipy.ndimage import label, binary_dilation
from common import *
import novelty
from semantics import sprite_class

@lru_cache(maxsize=None)
def tile_lookup():
    d = np.load(WORK/'tile_index.npz'); meta = json.load(open(WORK/'tile_index.json'))
    sheets = meta['sheets']
    m = {}
    for tid, (s, (cx, cy)) in enumerate(zip(d['src'], d['pos'])): m[(sheets[s], int(cx), int(cy))] = tid
    for k, lst in meta['dups'].items():
        for s, cx, cy in lst: m[(sheets[s], cx, cy)] = int(k)
    return m

@lru_cache(maxsize=None)
def file_to_sid():
    return {r['file']: (r['id'] if r['dup_of'] is None else r['dup_of']) for r in json.load(open(WORK/'catalog.json'))}

def to_ref_format(sc):
    """generated scene -> analysis scene format used by novelty.py"""
    tl = tile_lookup(); f2s = file_to_sid()
    cells = []
    for y in range(sc['rows']):
        row = []
        for x in range(sc['cols']):
            ids = []
            for layer in sc['ground']:
                t = layer[y][x]
                if t: ids.append(tl.get((sc['sheets'][t[0]], t[1], t[2]), -1))
            row.append([ids[0], ids[1] if len(ids) > 1 else -1] if ids else None)
        cells.append(row)
    objs = []
    for o in sc['objects']:
        if o['kind'] != 'sprite': continue
        sid = f2s.get(o['file'])
        if sid is None: continue
        objs.append(dict(sid=sid, x=o['x'], y=o['y'], w=o['w'], h=o['h'], cls=o['cls'], name=o['key']))
    return dict(name=sc['seed'], rows=sc['rows'], cols=sc['cols'], cells=cells, objects=objs)

def emptiness(open_mask, occupied_mask):
    """largest connected open area (cells) with no occupied cell within 1 cell"""
    near = binary_dilation(occupied_mask, iterations=1)
    empty = open_mask & ~near
    lab, n = label(empty)
    return int(np.bincount(lab.ravel())[1:].max()) if n else 0

def gen_metrics(sc):
    R, C = sc['rows'], sc['cols']
    cls = np.array(sc['cells'])
    main = (cls == 'walk') | (cls == 'lot')
    occ = np.zeros((R, C), bool)
    n_main = n_people = n_bld = 0
    for o in sc['objects']:
        x0, y0 = o['x'] // T, o['y'] // T
        x1, y1 = (o['x'] + o['w'] - 1) // T, (o['y'] + o['h'] - 1) // T
        if o['cls'] == 'building':
            occ[max(0, y0):max(0, y1 + 1), max(0, x0):max(0, x1 + 1)] = True
        else:
            fy, fx = o['foot'] // T, (o['x'] + o['w'] // 2) // T
            if 0 <= fy < R and 0 <= fx < C:
                occ[fy, fx] = True
                if main[fy, fx]:
                    if o['kind'] == 'char': n_people += 1
                    else: n_main += 1
    # placement sanity: furniture standing in the carriageway; sidewalk cut through by furniture
    on_road = sum(1 for o in sc['objects'] if o['kind'] == 'sprite' and o['cls'] not in ('vehicle', 'manhole', 'roadworks', 'building')
                  and 0 <= (o['foot'] - 1) // T < R and 0 <= (o['x'] + o['w'] // 2) // T < C and cls[(o['foot'] - 1) // T, (o['x'] + o['w'] // 2) // T] == 'road')
    S = 4   # 4-px grid over the main sidewalk; furniture footprint ~ middle half of the sprite width, 6 px above the foot
    walk = np.kron(cls == 'walk', np.ones((T // S, T // S), bool))
    free = walk.copy()
    for o in sc['objects']:
        if o['kind'] != 'sprite' or o['cls'] in ('building', 'vehicle', 'manhole'): continue
        x0, x1 = (o['x'] + o['w'] // 4) // S, (o['x'] + 3 * o['w'] // 4) // S + 1
        free[max(0, (o['foot'] - 6) // S):max(0, o['foot'] // S + 1), max(0, x0):max(0, x1)] = False
    from scipy.ndimage import distance_transform_edt as edt
    centre = edt(walk) * S >= 12                      # sidewalk centre line (>= 12 px from both edges)
    pinched = round(100 * float((centre & (edt(free) * S < 8)).sum()) / max(int(centre.sum()), 1), 1)
    open_main = main & ~occ
    return dict(on_road=on_road, pinched=pinched, main_cells=int(main.sum()), objects_per100=round(100 * n_main / max(main.sum(), 1), 1),
                people_per100=round(100 * n_people / max(main.sum(), 1), 1),
                largest_empty_patch=emptiness(main, occ),
                open_frac=round(float((main & ~binary_dilation(occ, iterations=1)).sum() / max(main.sum(), 1)), 3))

def ref_emptiness():
    """same emptiness rule on reference scenes: open = paved/sand/grass ground, occupied = any object cell"""
    out = {}
    for n in ref_names(('street',)):
        p = WORK/'scenes'/f'{n}.json'
        if not p.exists(): continue
        sc = json.load(open(p, encoding='utf-8'))
        G = np.array(sc['ground'], dtype=object)
        R, C = G.shape
        ox, oy = sc['phase']; cx0, cy0 = sc['origin']
        occ = G == 'building'
        for o in sc['objects']:
            if o.get('conf') == 'low': continue
            fy, fx = int((o['y'] + o['h'] - oy) // T - cy0), int((o['x'] + o['w'] / 2 - ox) // T - cx0)
            if 0 <= fy < R and 0 <= fx < C: occ[fy, fx] = True
        open_ = (G == 'paved') | (G == 'sand')
        out[n] = (emptiness(open_, occ), round(float((open_ & ~binary_dilation(occ, iterations=1)).sum() / max(open_.sum(), 1)), 3))
    return out

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    out = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else None
    if out in args: args.remove(out)
    refs = [novelty.load(n) for n in ref_names() if (WORK/'scenes'/f'{n}.json').exists()]
    gens = [(p, json.load(open(p, encoding='utf-8'))) for p in args]
    conv = [(p, to_ref_format(sc)) for p, sc in gens]
    L = ['| scene | copied windows | largest copied | copied objects | self-repeat (constellations) | obj/100 | people/100 | largest empty patch | open frac | furniture on road | sidewalk centre pinched % |',
         '|---|---|---|---|---|---|---|---|---|---|---|']
    for (p, sc), (_, cv) in zip(gens, conv):
        c = novelty.compare(cv, refs); s = novelty.self_constellations(cv); m = gen_metrics(sc)
        L.append(f"| {sc['seed']} | {c['copied_window_frac']} | {c['largest_copied_region_cells']} | {c['copied_object_frac']} | "
                 f"{s['repeated_constellation_frac']} | {m['objects_per100']} | {m['people_per100']} | {m['largest_empty_patch']} | {m['open_frac']} | {m['on_road']} | {m['pinched']} |")
    # diversity between seeds
    if len(conv) > 1:
        fr = []
        for i in range(len(conv)):
            for j in range(len(conv)):
                if i != j: fr.append(novelty.constellation_overlap(conv[i][1], conv[j][1]))
        L += ['', f'seed-vs-seed shared object constellations: mean {np.mean(fr):.3f}, max {np.max(fr):.3f}  (references: 0 between unrelated refs)']
    re = ref_emptiness()
    L += ['', 'reference calibration (street refs, same emptiness rule): largest empty patch / open frac',
          ', '.join(f'{k}:{v[0]}/{v[1]}' for k, v in sorted(re.items(), key=lambda kv: kv[1][0]))]
    txt = '\n'.join(L)
    print(txt)
    if out: open(out, 'w', encoding='utf-8').write(txt)

if __name__ == '__main__':
    main()
