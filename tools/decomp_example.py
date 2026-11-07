# Which pieces make up an example sprite: pixel-exact match of each piece's opaque pixels.
# usage (from tools/): STEP=1 uv run python decomp_example.py "<glob of example>" "<glob of pieces>" [threshold]
# (exp-05, NOTE D55: how the packs' sample buildings are put together)
# find where each piece occurs (pixel-exact on its opaque pixels, cell-aligned) in an example sprite
import sys,glob,os,re
import numpy as np
from PIL import Image
root='../assets/exteriors/'
ex=sys.argv[1]; pat=sys.argv[2]; thr=float(sys.argv[3]) if len(sys.argv)>3 else 0.98
STEP=int(os.environ.get("STEP","8"))
E=np.array(Image.open(glob.glob(root+ex)[0]).convert('RGBA')).astype(int)
H,W=E.shape[:2]
def k(f): return [int(t) if t.isdigit() else t for t in re.split(r'(\d+)',os.path.basename(f))]
fs=sorted([f for f in glob.glob(root+pat) if f.endswith('.png')],key=k)
for f in fs:
  P=np.array(Image.open(f).convert('RGBA')).astype(int)
  ph,pw=P.shape[:2]
  if ph>H or pw>W or (ph==H and pw==W): continue
  m=P[:,:,3]>200
  if m.sum()<20: continue
  hits=[]
  for y in range(0,H-ph+1,STEP):
    for x in range(0,W-pw+1,STEP):
      sub=E[y:y+ph,x:x+pw]
      eq=(np.abs(sub[:,:,:3]-P[:,:,:3]).sum(2)<6)&(sub[:,:,3]>200)
      s=(eq&m).sum()/m.sum()
      if s>=thr: hits.append((x/16,y/16,round(s,3)))
  if hits: print(re.sub(r'.*16x16_','',os.path.basename(f))[:-4], f'{pw//16}x{ph//16}', hits[:12])
