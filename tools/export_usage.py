"""Stage 7 novelty: how often each sprite is used in the references (spec 5.1).

  uv run python export_usage.py   -> app/src/gen/data/usage.json

usage.json: {"counts": {key: n}, "max": n, "sources": {"refworld": files}}. n counts
  - objects of work/refworld/*.json with conf == 'high' (reference detections);
  - every modular building family (a key of modular.json) = the sum of its pieces' counts.
Recomputed only by this script, never at generation time (reproducible output).
(Until 0.7.5 the scenes saved as acceptable, references/holdout/, counted too; none were ever saved.)
"""
import json
from collections import Counter
from common import ROOT

OUT = ROOT/'app'/'src'/'gen'/'data'

def main():
    n = Counter()
    refs = sorted((ROOT/'work'/'refworld').glob('*.json'))
    for f in refs:
        for o in json.load(open(f, encoding='utf-8'))['objects']:
            if o.get('conf') == 'high': n[o['key']] += 1
    mod = json.load(open(OUT/'modular.json', encoding='utf-8'))
    fams = {fam: sum(n[p['key']] for p in ps) for fam, ps in mod.items()}
    for fam, c in fams.items():
        if c: n[fam] += c
    counts = dict(sorted(n.items()))
    out = {'counts': counts, 'max': max(counts.values(), default=0), 'sources': {'refworld': len(refs)}}
    # utf-8 and LF on every platform (Windows text mode wrote CRLF)
    with open(OUT/'usage.json', 'w', encoding='utf-8', newline='\n') as f: json.dump(out, f, indent=0)
    print(f"{len(counts)} keys, max {out['max']}, sources {out['sources']} -> {OUT/'usage.json'}")

if __name__ == '__main__':
    main()
