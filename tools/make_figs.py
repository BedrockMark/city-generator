"""Illustrative crops for docs/reports/ANALYSIS.md (native px boxes, upscaled x2)."""
from PIL import Image
from common import *
FIGS = {
    'crossing_axis':      ('market_on_street',        (90, 40, 250, 275)),
    'bus_stop_trash':     ('suburb_neighborhood_1',   (180, 200, 330, 335)),
    'road_works':         ('hotel',                   (0, 320, 357, 415)),
    'symmetry_fountain':  ('neighborhood',            (0, 0, 308, 192)),
    'curb_rhythm':        ('simple_resident_complex', (0, 330, 420, 410)),
    'shop_front_dense':   ('police_station',          (0, 150, 292, 331)),
    'corner_furniture':   ('simple_street_corner',    (0, 100, 260, 330)),
}
out = ROOT/'docs'/'reports'/'fig'
for k, (n, box) in FIGS.items():
    im = Image.open(REFS/f'{n}.png').crop(box)
    im.resize((im.width * 2, im.height * 2), Image.NEAREST).save(out/f'{k}.png')
print('ok')
