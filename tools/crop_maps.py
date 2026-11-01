"""Write the map crop of each reference to work/maps/<name>.png (for eyeballing ROIs)."""
from PIL import Image
from common import *
out = WORK/'maps'; out.mkdir(exist_ok=True)
for n in ref_names():
    a, _ = load_map(n)
    Image.fromarray(a).resize((a.shape[1]*2, a.shape[0]*2), Image.NEAREST).save(out/f'{n}.png')
print('ok')
