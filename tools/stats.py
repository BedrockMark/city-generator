"""Relation statistics over analysed reference scenes (work/scenes/*.json).

Produces work/stats/stats.json and work/stats/summary.md with:
  * class counts & densities (objects per 100 visible cells), per kind (street/site/showcase)
  * per class: ground class under the object's foot, distance to nearest road / building cell
  * class-pair co-occurrence lift within radius R vs. shuffled baseline (which things go together)
  * typical relative offsets for the strongest pairs
  * regular rows: same sprite repeated with constant spacing (planters, lamps, bollards ...)
Usage: uv run python stats.py [kinds=street,site]
"""
import sys, json, math
import numpy as np
from collections import Counter, defaultdict
from scipy.ndimage import distance_transform_edt
from common import *

R_NEAR = 40       # px: "next to each other"
OUT = WORK/'stats'
cat = {r['id']: r for r in json.load(open(WORK/'catalog.json'))}

def foot(o):
    """bottom-centre of the sprite's opaque bbox (where it 'stands')."""
    bx0, by0, bx1, by1 = cat[o['sid']]['bbox']
    return o['x'] + (bx0 + bx1) / 2, o['y'] + by1 - 1

def cell_of(sc, x, y):
    ox, oy = sc['phase']; cx0, cy0 = sc['origin']
    return int((y - oy) // T - cy0), int((x - ox) // T - cx0)

def load_scenes(kinds):
    out = []
    for n in ref_names(kinds):
        p = WORK/'scenes'/f'{n}.json'
        if p.exists():
            sc = json.load(open(p)); sc['kind'] = META[n]['kind']; out.append(sc)
    return out

def per_scene(sc):
    G = np.array(sc['ground'], dtype=object)
    R, C = G.shape
    road = (G == 'road'); bld = (G == 'building')
    d_road = distance_transform_edt(~road) * T if road.any() else np.full(G.shape, np.inf)
    d_bld = distance_transform_edt(~bld) * T if bld.any() else np.full(G.shape, np.inf)
    rows = []
    for o in sc['objects']:
        if o['cls'] == 'building' or o.get('conf') == 'low': continue
        fx, fy = foot(o)
        r, c = cell_of(sc, fx, fy)
        inside = 0 <= r < R and 0 <= c < C
        rows.append(dict(o, fx=fx, fy=fy, ground=G[r, c] if inside else '',
                         d_road=float(d_road[r, c]) if inside else math.inf,
                         d_bld=float(d_bld[r, c]) if inside else math.inf))
    return rows, int((G != '').sum())

def pair_lift(rows, rng, n_shuffle=30):
    """co-occurrence of class pairs within R_NEAR vs. class-label shuffle baseline."""
    if len(rows) < 3: return Counter(), Counter()
    P = np.array([[o['fx'], o['fy']] for o in rows]); cls = np.array([o['cls'] for o in rows])
    D = np.hypot(*(P[:, None, :] - P[None, :, :]).transpose(2, 0, 1))
    near = (D < R_NEAR) & ~np.eye(len(rows), dtype=bool)
    I, J = np.nonzero(np.triu(near))
    obs = Counter(tuple(sorted((cls[i], cls[j]))) for i, j in zip(I, J))
    exp = Counter()
    for _ in range(n_shuffle):
        s = rng.permutation(cls)
        exp.update(tuple(sorted((s[i], s[j]))) for i, j in zip(I, J))
    return obs, Counter({k: v / n_shuffle for k, v in exp.items()})

def regular_rows(rows):
    """same sprite id, same foot y (±1), >=3 items, constant spacing (±2px)."""
    out = []
    by = defaultdict(list)
    for o in rows: by[(o['sid'], round(o['fy'] / 2))].append(o['fx'])
    for (sid, _), xs in by.items():
        if len(xs) < 3: continue
        xs = sorted(xs); d = np.diff(xs)
        if d.max() - d.min() <= 2: out.append((cat[sid]['name'], len(xs), int(np.median(d))))
    return out

def main():
    kinds = tuple(sys.argv[1].split(',')) if len(sys.argv) > 1 else ('street', 'site')
    scenes = load_scenes(kinds)
    rng = np.random.default_rng(0)
    allrows, area, obs_t, exp_t = [], 0, Counter(), Counter()
    per_ref, rowsets = {}, {}
    for sc in scenes:
        rows, a = per_scene(sc)
        allrows += rows; area += a
        o, e = pair_lift(rows, rng); obs_t += o; exp_t += e
        per_ref[sc['name']] = dict(kind=sc['kind'], cells=a, objects=len(rows),
                                   density=round(100 * len(rows) / max(a, 1), 1),
                                   classes=Counter(r['cls'] for r in rows).most_common())
        rowsets[sc['name']] = regular_rows(rows)
    cls_stats = {}
    for c in sorted({r['cls'] for r in allrows}):
        rs = [r for r in allrows if r['cls'] == c]
        dr = [r['d_road'] for r in rs if np.isfinite(r['d_road'])]
        db = [r['d_bld'] for r in rs if np.isfinite(r['d_bld'])]
        cls_stats[c] = dict(n=len(rs), refs=len({r.get('_ref', '') for r in rs}),
                            ground=Counter(r['ground'] for r in rs).most_common(4),
                            d_road_med=float(np.median(dr)) if dr else None,
                            d_bld_med=float(np.median(db)) if db else None,
                            top_sprites=Counter(r['name'] for r in rs).most_common(6))
    lifts = []
    for k, v in obs_t.items():
        e = exp_t.get(k, 0.0)
        if v >= 4: lifts.append((k, v, round(e, 1), round((v + 1) / (e + 1), 2)))
    lifts.sort(key=lambda t: -t[3])
    OUT.mkdir(exist_ok=True)
    json.dump(dict(per_ref=per_ref, classes=cls_stats, lifts=lifts, rows=rowsets), open(OUT/'stats.json', 'w'), indent=1)
    L = ['# Reference statistics (auto-generated by tools/stats.py)', '', f'kinds: {kinds}, scenes: {len(scenes)}', '',
         '## Per reference', '', '| ref | kind | cells | objects | obj/100 cells | top classes |', '|---|---|---|---|---|---|']
    for n, d in sorted(per_ref.items(), key=lambda kv: -kv[1]['density']):
        L.append(f"| {n} | {d['kind']} | {d['cells']} | {d['objects']} | {d['density']} | " +
                 ', '.join(f'{c}:{k}' for c, k in d['classes'][:6]) + ' |')
    L += ['', '## Per class', '', '| class | n | ground under foot | median dist to road px | median dist to building px | top sprites |',
          '|---|---|---|---|---|---|']
    for c, d in sorted(cls_stats.items(), key=lambda kv: -kv[1]['n']):
        L.append(f"| {c} | {d['n']} | " + ', '.join(f'{g or "?"}:{k}' for g, k in d['ground']) +
                 f" | {d['d_road_med']} | {d['d_bld_med']} | " + ', '.join(f'{s}({k})' for s, k in d['top_sprites']) + ' |')
    L += ['', f'## Class pairs within {R_NEAR}px: observed vs shuffled-label expectation (lift)', '',
          '| pair | observed | expected | lift |', '|---|---|---|---|']
    for k, v, e, l in lifts[:40]: L.append(f'| {k[0]} + {k[1]} | {v} | {e} | {l} |')
    L += ['', '## Regular rows (same sprite, same baseline, constant spacing)', '']
    for n, rs in rowsets.items():
        if rs: L.append(f'- {n}: ' + '; '.join(f'{s} x{k} every {d}px' for s, k, d in rs))
    open(OUT/'summary.md', 'w', encoding='utf-8').write('\n'.join(L))
    print('\n'.join(L[:12])); print('...'); print(f'written {OUT/"summary.md"}')

if __name__ == '__main__':
    main()
