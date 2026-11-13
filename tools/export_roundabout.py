"""Re-derive the roundabout's road / walk classes (RB_CLASS in app/src/world/roundabout.ts) from the asset.

2_City_Terrains_16x16.png holds a 15 x 13 cell roundabout at cols 14..28, rows 9..21 of each paving colour block
(spec v0.8.3 2.1, 2.3). A source cell is road ('r') when >= 128 of its 256 pixels have one of the colours of the plain
asphalt cell (15, 1), plain asphalt ('A') when it is pixel-equal to (15, 1), else walk ('w'). The asphalt is the same
in all six colour blocks, so block (0, 0) is read. Prints the 13 rows and compares them with the table in the code;
exit code 1 when they differ.
Usage: uv run python export_roundabout.py
"""
import re, sys
import numpy as np
from PIL import Image
from common import ROOT, ASSETS

T = 16
COLS, ROWS = range(14, 29), range(9, 22)
PLAIN = (15, 1)
TS = ROOT/'app'/'src'/'world'/'roundabout.ts'

def cell(img: np.ndarray, c: int, r: int) -> np.ndarray:
    return img[r * T:(r + 1) * T, c * T:(c + 1) * T]

def derive() -> list[str]:
    img = np.asarray(Image.open(ASSETS/'exteriors'/'2_City_Terrains_16x16.png').convert('RGBA'))
    plain = cell(img, *PLAIN)
    colours = {tuple(p) for p in plain.reshape(-1, 4)}
    out = []
    for r in ROWS:
        row = ''
        for c in COLS:
            px = cell(img, c, r)
            n = sum(tuple(p) in colours for p in px.reshape(-1, 4))
            row += 'A' if np.array_equal(px, plain) else 'r' if n >= 128 else 'w'
        out.append(row)
    return out

def in_code() -> list[str]:
    src = TS.read_text(encoding='utf-8')
    m = re.search(r'RB_CLASS[^=]*=\s*\[(.*?)\];', src, re.S)
    return re.findall(r"'([wrA]+)'", m.group(1)) if m else []

def main():
    rows = derive()
    for r, row in zip(ROWS, rows): print(f'{r:2d} {row}')
    code = in_code()
    if code == rows:
        print('RB_CLASS matches')
        return 0
    print('RB_CLASS differs from app/src/world/roundabout.ts:')
    for r, (a, b) in enumerate(zip(rows, code + [''] * (len(rows) - len(code)))):
        if a != b: print(f'  row {r + 9}: asset {a}  code {b}')
    return 1

if __name__ == '__main__':
    sys.exit(main())
