"""Export asset metadata for the TypeScript generator -> app/src/gen/data/*.json

sprites.json   : {"<pack>/<name>": [file, w, h, bx0, by0, bx1, by1]}  (Singles of the packs the generator uses)
autotile.json  : 47-blob tables from autotile.py
characters.json: layer files per category + theme tags
Usage: uv run python export_manifest.py
"""
import json, shutil
from common import *

PACKS = ('3_City_Props', '4_Generic_Building', '5_Floor_Modular_Building', '6_Garage_Sales', '7_Villas', '9_Shopping_Center',
         '10_Vehicles', '16_Office', '17_Garden', '22_Post_Office', '24_Additional_Houses', '12_Hotel', '8_Worksite', '11_Camping',
         '13_School', '15_Police_Station', '18_Fire_Station')
OUT = ROOT/'app'/'src'/'gen'/'data'

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    cat = json.load(open(WORK/'catalog.json'))
    sp = {}
    for r in cat:
        if not r['pack'].startswith(PACKS): continue
        key = f"{r['pack']}/{r['name']}"
        if key in sp: continue
        sp[key] = [r['file'], r['w'], r['h'], *r['bbox']]
    json.dump(sp, open(OUT/'sprites.json', 'w'), separators=(',', ':'))
    shutil.copy(WORK/'autotile.json', OUT/'autotile.json')
    # modular floor pieces: family + wall colour class (so a stacked building keeps one colourway)
    import re, numpy as np
    mod = {}
    rx = re.compile(r'^(Middle_Floor|Roof|Ground_Floor_[A-Za-z_]+?)_(\d+)$')
    for r in cat:
        if not r['pack'].startswith('5_Floor') or r['dup_of'] is not None: continue
        m = rx.match(r['name'])
        if not m or 'Modular' in r['name'] or 'Props' in r['name']: continue
        col = None  # filled below from variant order: each family is ordered red, blue, grey in thirds
        if m.group(1) == 'Roof': col = 'any'
        mod.setdefault(m.group(1), []).append(dict(key=f"{r['pack']}/{r['name']}", colour=col, h=r['th'], v=int(m.group(2))))
    for fam, lst in mod.items():
        n = max(x['v'] for x in lst)
        for x in lst:
            if x['colour'] is None: x['colour'] = ['red', 'blue', 'grey'][min(2, (x['v'] - 1) * 3 // n)]
    json.dump(mod, open(OUT/'modular.json', 'w'), indent=0)
    print({k: dict(__import__('collections').Counter(x['colour'] for x in v)) for k, v in mod.items()})
    ch = json.load(open(WORK/'characters'/'catalog.json'))
    themes = json.load(open(ROOT/'tools'/'character_themes.json', encoding='utf-8'))
    json.dump(dict(layers=ch, themes=themes), open(OUT/'characters.json', 'w'), separators=(',', ':'))
    print(f'sprites {len(sp)}; autotile; characters -> {OUT}')

if __name__ == '__main__':
    main()
