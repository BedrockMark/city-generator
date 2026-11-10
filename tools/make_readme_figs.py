"""Build the figures used by the top-level README (docs/readme/*.png).

Inputs (all regenerable):
  work/readme_shots/            exports from the viewer:
                                cd app && npx tsx scripts/shots.ts ../work/readme_shots --anno --q=d=none 7 2 13
                                and one seed each for the special districts:
                                npx tsx scripts/shots.ts ../work/readme_shots/<d> --q=d=<d> <seed>   (school 3, palace 3, gas 3, hospital 6)
  work/refs/shop_on_street.png  normalized reference map (tools/run_analysis.sh step normalize_refs.py)
  docs/reports/fig/*.png        reference crops made by tools/make_figs.py

Run from tools/:  uv run python make_readme_figs.py
Exports are 2x (plain) / 3x (annotated); figures are brought back to native 1x with nearest-neighbour so pixels stay crisp.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / 'work' / 'readme_shots'
OUT = ROOT / 'docs' / 'readme'
OUT.mkdir(parents=True, exist_ok=True)
VER = 'v0.7.9.1'
try:
    FONT = ImageFont.truetype('arial.ttf', 15)
except OSError:
    FONT = ImageFont.load_default()
BG = (29, 29, 36)
FG = (225, 225, 230)


def native(p: Path, factor: int) -> Image.Image:
    im = Image.open(p).convert('RGBA')
    return im.resize((im.width // factor, im.height // factor), Image.NEAREST)


def captioned(im: Image.Image, text: str, pad: int = 6) -> Image.Image:
    h = 24
    out = Image.new('RGBA', (im.width, im.height + h), BG)
    out.paste(im, (0, h))
    ImageDraw.Draw(out).text((pad, 4), text, fill=FG, font=FONT)
    return out


def row(images: list[Image.Image], gap: int = 12) -> Image.Image:
    h = max(i.height for i in images)
    w = sum(i.width for i in images) + gap * (len(images) - 1)
    out = Image.new('RGBA', (w, h), BG)
    x = 0
    for i in images:
        out.paste(i, (x, 0))
        x += i.width + gap
    return out


def fit_height(im: Image.Image, h: int) -> Image.Image:
    return im.resize((round(im.width * h / im.height), h), Image.LANCZOS)


def save(im: Image.Image, name: str) -> None:
    p = OUT / name
    im.convert('RGB').save(p, optimize=True)
    print(f'{name}: {im.width}x{im.height}, {p.stat().st_size // 1024} KB')


# 1. hero: a plain block, seed 2
hero = native(SHOTS / f'citygen_{VER}_seed2.png', 2)
save(hero, 'hero_seed2.png')

# 2. special districts, one image each (shown as a 2x2 table in the README)
for d, seed in [('school', 3), ('palace', 3), ('hospital', 6), ('gas', 3)]:
    save(native(SHOTS / d / f'citygen_{VER}_seed{seed}_d{d}.png', 2), f'district_{d}.png')

# 3. reference vs generated
ref = Image.open(ROOT / 'work' / 'refs' / 'shop_on_street.png').convert('RGBA')
gen = hero.crop((240, 140, 800, 580))
save(row([captioned(ref, 'Hand-made reference map (shop_on_street)'),
          captioned(gen, 'Generated block, seed 2 (same tileset, new layout)')]), 'reference_vs_generated.png')

# 4. what "organic" means: reference crops from the analysis report
figs = [('bus_stop_trash.png', 'bus shelter + sign + bins behind'),
        ('crossing_axis.png', 'crossing on the door axis'),
        ('shop_front_dense.png', 'shop front: sign, phone, parking, people')]
save(row([captioned(fit_height(Image.open(ROOT / 'docs' / 'reports' / 'fig' / f).convert('RGBA'), 270), t) for f, t in figs]),
     'organic_details.png')

# 5. the annotation layer (3x export, cropped to the main block, shown at 2x)
anno = Image.open(SHOTS / f'citygen_{VER}_seed7_annotated.png').convert('RGBA').crop((588, 465, 2038, 1614))
save(anno.resize((anno.width * 2 // 3, anno.height * 2 // 3), Image.LANCZOS), 'annotated_seed7.png')

# 6. the viewer with the annotation side panel open
save(Image.open(SHOTS / 'ui_anno_seed7.png').convert('RGBA'), 'viewer_annotate.png')
