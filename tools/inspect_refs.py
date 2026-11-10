"""Quick stats of reference images: size, frames, mode."""
import sys
from pathlib import Path
from PIL import Image
root = Path(__file__).resolve().parent.parent
for p in sorted((root/'references').glob('*.*')):
    if p.is_dir() or p.suffix.lower() not in ('.gif', '.png'): continue
    im = Image.open(p)
    print(f"{p.name:45s} {im.size[0]:5d}x{im.size[1]:<5d} mode={im.mode} frames={getattr(im,'n_frames',1)}")
for p in sorted((root/'assets').rglob('*_16x16.png')):
    if 'Singles' in p.parent.name: continue
    im = Image.open(p); print('SHEET', p.relative_to(root), im.size)
