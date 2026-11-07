"""exp-04: seam strips of the floor-modular buildings -> app/src/gen/data/links.json

Every 7-wide roof / middle floor / ground floor of 5_Floor_Modular_Building has 1-wide "_Modular" strips that replace its
left or right edge column (the pilaster / parapet side) so two pieces standing side by side read as one facade
(reference shop_on_street: two Middle_Floor_5 with Middle_Floor_Modular_10 / _9 over the touching columns).
Which strip belongs to which piece and side:
  1. the combined sheet: the strip drawn right next to the piece (x-1 = left, x+7 = right), bottom-aligned;
  2. otherwise the strip whose pixels agree best with the piece's edge column (at least MIN_AGREE), facades only.
Roof_10's right strip is not on the sheet: Roof_Modular_13 by analogy with Roof_7.
Music_Store pieces are skipped (their strips cannot be told apart by side).
Pitched roofs with firewall pillars (Roof_8/9/11) get none: the pillar is the party wall.
Output: {"<piece key>": {"L": "<strip key>" | null, "R": ...}}; strips are bottom-aligned with the piece.
Usage: uv run python export_links.py
"""
import json, re
import numpy as np
from PIL import Image
from common import *

OUT = ROOT/'app'/'src'/'gen'/'data'/'links.json'
PACK = '5_Floor_Modular_Building'
SHEET = ASSETS/'exteriors'/'5_Floor_Modular_Buildings_16x16.png'
MIN_AGREE = 0.6
PILLARED = {'Roof_8', 'Roof_9', 'Roof_11'}
# its strips match neither side reliably (L and R strips score alike on the edge columns): never linked
SKIP = ('Ground_Floor_Music_Store',)
# not drawn next to its piece on the sheet; by analogy with Roof_7 (Roof_Modular_10 / _11)
MANUAL = {('Roof_10', 'R'): 'Roof_Modular_13'}
RX = re.compile(r'^(Roof|Middle_Floor|Ground_Floor_[A-Za-z_]+?)(_Modular)?_(\d+)$')


def load(path):
    a = np.array(Image.open(path).convert('RGBA'))
    a[a[..., 3] == 0] = 0
    return a


def main():
    cat = [r for r in json.load(open(WORK/'catalog.json')) if r['pack'].startswith(PACK) and r['dup_of'] is None]
    full, strips = {}, {}
    for r in cat:
        m = RX.match(r['name'])
        if not m or m.group(1).endswith('Props'): continue
        (strips if m.group(2) else full)[r['name']] = (m.group(1), load(ASSETS/r['file']))
    sheet = load(SHEET)
    H, W = sheet.shape[0] // 16, sheet.shape[1] // 16
    cells = {}
    for y in range(H):
        for x in range(W):
            cells.setdefault(sheet[y*16:y*16+16, x*16:x*16+16].tobytes(), []).append((x, y))

    def where(a):
        h, w = a.shape[0] // 16, a.shape[1] // 16
        return [(x, y) for x, y in cells.get(a[:16, :16].tobytes(), [])
                if y + h <= H and x + w <= W and np.array_equal(sheet[y*16:(y+h)*16, x*16:(x+w)*16], a)]

    at = {n: where(a) for n, (_, a) in {**full, **strips}.items()}
    out, how = {}, {'sheet': 0, 'pixels': 0, 'manual': 0, 'none': 0}
    for pn, (fam, p) in sorted(full.items()):
        res = {'L': None, 'R': None}
        if pn not in PILLARED and fam not in SKIP:
            ph = p.shape[0] // 16
            for side, cx in (('L', 0), ('R', p.shape[1] // 16 - 1)):
                cand = [(sn, s) for sn, (sf, s) in strips.items() if sf == fam and s.shape[0] <= p.shape[0]]
                # 1. drawn next to it on the sheet, bottom-aligned
                for px, py in at[pn]:
                    nx = px - 1 if side == 'L' else px + p.shape[1] // 16
                    hit = next((sn for sn, s in cand if (nx, py + ph - s.shape[0] // 16) in at[sn]), None)
                    if hit: res[side] = hit; how['sheet'] += 1; break
                # 2. best pixel agreement with the edge column (facades only; roof strips differ too much)
                if not res[side] and fam != 'Roof':
                    col = p[:, cx*16:cx*16+16]
                    sc = sorted(((col[-s.shape[0]:] == s).all(-1).mean(), sn) for sn, s in cand)
                    if sc and sc[-1][0] >= MIN_AGREE: res[side] = sc[-1][1]; how['pixels'] += 1
                if not res[side] and (pn, side) in MANUAL: res[side] = MANUAL[pn, side]; how['manual'] += 1
                if not res[side]: how['none'] += 1
        out[f'{PACK}/{pn}'] = {k: (f'{PACK}/{v}' if v else None) for k, v in res.items()}
    json.dump(out, open(OUT, 'w'), indent=0)
    print(how, '->', OUT)
    for k, v in out.items():
        if not v['L'] or not v['R']: print('  partial:', k.split('/')[-1], v)


if __name__ == '__main__':
    main()
