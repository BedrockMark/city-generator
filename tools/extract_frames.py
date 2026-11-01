"""Extract first frame of each reference into work/refs_raw/*.png (RGBA)."""
from pathlib import Path
from PIL import Image
root = Path(__file__).resolve().parent.parent
out = root/'work'/'refs_raw'; out.mkdir(parents=True, exist_ok=True)
for p in sorted((root/'references').glob('*.*')):
    if p.is_dir(): continue
    im = Image.open(p); im.seek(0)
    im.convert('RGBA').save(out/(p.stem+'.png'))
print('done')
