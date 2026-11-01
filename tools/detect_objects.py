"""Detect asset sprites (Singles) inside reference maps at arbitrary pixel offsets.

Robust to: GIF colour quantisation (tolerance), partial occlusion (inlier fraction),
sprites cut by the map border (image-side validity mask via padding).

Method per sprite:
  1. masked SSD over all offsets via 4 correlations (cv2.matchTemplate TM_CCORR):
       SSD = corr(Mi*|I|^2, Mt) - 2 corr(Mi*I, Mt*T) + corr(Mi, Mt*|T|^2),  N = corr(Mi, Mt)
  2. candidates = local minima with visible N >= min_vis and MSE < loose threshold
  3. verify candidate: per-pixel max channel diff <= TOL -> inliers; keep if inlier frac >= FRAC
Then greedy explanation: sort detections by inlier count, accept a detection only if most of its
inlier pixels are not already claimed by an accepted detection (kills sub-parts / duplicates).

Usage: uv run python detect_objects.py [names...]   (default: all non-thumb refs, multiprocess)
Output: work/detect/<name>.json, work/detect/<name>_overlay.png, work/detect/<name>_residual.png
"""
import sys, json, time
import numpy as np, cv2
from multiprocessing import Pool
from PIL import Image, ImageDraw
from common import *

TOL = 20          # per-channel abs diff counted as inlier
FRAC = 0.62       # min inlier fraction of visible opaque pixels
MIN_PIX = 24      # min inlier pixels
MIN_VIS = 0.45    # min fraction of sprite's opaque pixels inside map
LOOSE_MSE = 2500  # candidate threshold on per-channel mean squared error
MAX_CAND = 400
OUT = WORK/'detect'

_sprites = None
def sprites():
    global _sprites
    if _sprites is None:
        cat = json.load(open(WORK/'catalog.json'))
        _sprites = []
        for r in cat:
            if r['dup_of'] is not None or r['opaque'] < MIN_PIX: continue
            s = load_rgba(ASSETS/r['file'])
            m = (s[..., 3] == 255)
            if m.sum() < MIN_PIX: continue
            T_ = s[..., :3].astype(np.float32) - 128
            _sprites.append((r, m, T_))
    return _sprites

def corr(img, tpl):
    return cv2.matchTemplate(img, tpl, cv2.TM_CCORR)

def detect_sprite(I, Mi, I2, r, m, T_, G):
    h, w = m.shape
    H, W = Mi.shape
    if h > H + h or w > W + w: return []
    # pad so sprite may hang over the border
    ph, pw = h - 1, w - 1
    Ip = cv2.copyMakeBorder(I, ph, ph, pw, pw, cv2.BORDER_CONSTANT, value=0)
    Mp = cv2.copyMakeBorder(Mi, ph, ph, pw, pw, cv2.BORDER_CONSTANT, value=0)
    I2p = cv2.copyMakeBorder(I2, ph, ph, pw, pw, cv2.BORDER_CONSTANT, value=0)
    Mt = m.astype(np.float32)
    MtT = T_ * Mt[..., None]
    T2 = (T_ ** 2).sum(-1) * Mt
    N = corr(Mp, Mt)
    ssd = corr(I2p, Mt) - 2 * corr(Ip, MtT) + corr(Mp, T2)
    nop = m.sum()
    vis_ok = N >= max(MIN_VIS * nop, MIN_PIX)
    mse = np.where(vis_ok, ssd / np.maximum(3 * N, 1), 1e9)
    cand = mse < LOOSE_MSE
    if not cand.any(): return []
    # local minima in 5x5
    mn = cv2.erode(mse.astype(np.float32), np.ones((5, 5), np.uint8))
    cand &= mse <= mn
    ys, xs = np.nonzero(cand)
    if len(ys) > MAX_CAND:
        o = np.argsort(mse[ys, xs])[:MAX_CAND]; ys, xs = ys[o], xs[o]
    out = []
    Iu = Ip + 128
    Tu = T_ + 128
    Gp = cv2.copyMakeBorder(G.astype(np.uint8), ph, ph, pw, pw, cv2.BORDER_CONSTANT, value=0) > 0
    for y, x in zip(ys, xs):
        win = Iu[y:y + h, x:x + w]
        vm = Mp[y:y + h, x:x + w] > 0
        vis = m & vm
        nv = vis.sum()
        if nv < MIN_PIX: continue
        good = (np.abs(win - Tu).max(-1) <= TOL) & vis
        ni = int(good.sum())
        if ni < MIN_PIX or ni / nv < FRAC: continue
        good &= ~Gp[y:y + h, x:x + w]          # informative = not already explained by the grid layer
        nfo = int(good.sum())
        if nfo < max(MIN_PIX, 0.25 * ni): continue
        out.append(dict(id=r['id'], name=r['name'], pack=r['pack'], x=int(x - pw), y=int(y - ph),
                        w=w, h=h, inliers=ni, informative=nfo, visible=int(nv), frac=round(ni / nv, 3),
                        mse=round(float(mse[y, x]), 1), _good=good))
    return out

def resolve(dets, shape):
    """Greedy explanation: biggest inlier sets first; reject detections mostly explained already."""
    H, W = shape
    claimed = np.zeros((H, W), bool)
    dets.sort(key=lambda d: (-d['informative'], -d['frac']))
    kept = []
    for d in dets:
        g = d['_good']; x, y = d['x'], d['y']
        ys, xs = np.nonzero(g)
        ys = ys + y; xs = xs + x
        inb = (ys >= 0) & (ys < H) & (xs >= 0) & (xs < W)
        ys, xs = ys[inb], xs[inb]
        new = ~claimed[ys, xs]
        if new.sum() < max(MIN_PIX, 0.5 * len(ys)): continue
        claimed[ys[new], xs[new]] = True
        d['new_pixels'] = int(new.sum())
        kept.append(d)
    return kept, claimed

def run(name):
    t0 = time.time()
    a, off = load_map(name)
    I = a[..., :3].astype(np.float32) - 128
    Mi = np.ones(a.shape[:2], np.float32)
    I2 = (I ** 2).sum(-1)
    bg = load_rgba(WORK/'grid'/f'{name}_bg.png')
    G = (bg[..., 3] > 0) & (np.abs(bg[..., :3].astype(int) - a[..., :3].astype(int)).max(-1) <= TOL)
    dets = []
    for r, m, T_ in sprites():
        dets += detect_sprite(I, Mi, I2, r, m, T_, G)
    kept, claimed = resolve(dets, a.shape[:2])
    claimed |= G
    OUT.mkdir(exist_ok=True)
    for d in kept: d.pop('_good')
    json.dump(dict(name=name, offset=off, size=[a.shape[1], a.shape[0]], coverage=float(claimed.mean()),
                   n_raw=len(dets), objects=kept), open(OUT/f'{name}.json', 'w'), indent=0)
    # overlay
    S = 3
    im = Image.fromarray(a[..., :3]).resize((a.shape[1] * S, a.shape[0] * S), Image.NEAREST)
    dr = ImageDraw.Draw(im)
    for d in kept:
        col = (255, 0, 255) if d['frac'] > .85 else (255, 160, 0)
        dr.rectangle([d['x'] * S, d['y'] * S, (d['x'] + d['w']) * S - 1, (d['y'] + d['h']) * S - 1], outline=col)
        dr.text((d['x'] * S + 2, d['y'] * S + 1), d['name'][:22], fill=col)
    im.save(OUT/f'{name}_overlay.png')
    res = a[..., :3].copy(); res[claimed] = (res[claimed] * 0.25).astype(np.uint8)
    Image.fromarray(res).resize((a.shape[1] * 2, a.shape[0] * 2), Image.NEAREST).save(OUT/f'{name}_residual.png')
    return f"{name:36s} objects={len(kept):4d} raw={len(dets):6d} coverage={claimed.mean():.3f} {time.time()-t0:.0f}s"

if __name__ == '__main__':
    names = sys.argv[1:] or ref_names()
    if len(names) == 1:
        print(run(names[0]))
    else:
        with Pool(12) as p:
            for line in p.imap_unordered(run, names): print(line, flush=True)
