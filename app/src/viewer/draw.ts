// Phaser drawing helpers shared by the single-block and city viewers (moved out of main.ts in 0.8.1).
import Phaser from 'phaser';
import type { Placed, TileRef } from '../gen/types';

export const ASSET_ROOT = 'assets/';

/** queue every texture these sheets / objects need that is not loaded yet, then done() */
export function loadTextures(sc: Phaser.Scene, sheets: Record<string, string>, objects: Placed[], done: () => void): void {
  const need = new Map<string, { kind: 'image' | 'sheet'; fw: number; fh: number }>();
  for (const k of Object.keys(sheets)) need.set(sheets[k], { kind: 'sheet', fw: 16, fh: 16 });
  for (const o of objects) {
    if (o.kind === 'sprite') need.set(o.file, { kind: 'image', fw: 0, fh: 0 });
    else for (const l of o.layers ?? []) need.set(l, { kind: 'sheet', fw: 16, fh: 32 });
  }
  let queued = 0;
  for (const [file, n] of need) {
    if (sc.textures.exists(file)) continue;
    queued++;
    if (n.kind === 'image') sc.load.image(file, ASSET_ROOT + file);
    else sc.load.spritesheet(file, ASSET_ROOT + file, { frameWidth: n.fw, frameHeight: n.fh });
  }
  if (queued) { sc.load.once(Phaser.Loader.Events.COMPLETE, done); sc.load.start(); } else done();
}

/** frame index of (col,row) in a sheet loaded with 16-px wide frames (sheet widths are not always multiples) */
function frameIndex(sc: Phaser.Scene, tex: string, col: number, row: number, fw: number) {
  const w = sc.textures.get(tex).source[0].width;
  return row * Math.floor(w / fw) + col;
}

/** a px rect of a texture as a frame of its own (exp-09 clipped sprites) */
function region(sc: Phaser.Scene, file: string, x0: number, y0: number, x1: number, y1: number): string {
  const tex = sc.textures.get(file);
  const name = `rect${x0}_${y0}_${x1}_${y1}`;
  if (!tex.has(name)) tex.add(name, 0, x0, y0, x1 - x0, y1 - y0);
  return name;
}

/** sub-frame of an image texture (rows y0..y1), created on demand */
function band(sc: Phaser.Scene, file: string, y0: number, y1: number): string {
  const tex = sc.textures.get(file);
  const name = `band${y0}_${y1}`;
  if (!tex.has(name)) tex.add(name, 0, 0, y0, tex.source[0].width, y1 - y0);
  return name;
}

/** ground layers into rt (call inside rt.beginDraw()/endDraw()); dx, dy: px offset of the grid */
export function drawGround(sc: Phaser.Scene, rt: Phaser.GameObjects.RenderTexture, sheets: Record<string, string>,
  ground: (TileRef | null)[][][], dx = 0, dy = 0): void {
  for (const layer of ground) for (let y = 0; y < layer.length; y++) for (let x = 0; x < layer[y].length; x++) {
    const t = layer[y][x];
    if (!t) continue;
    const tex = sheets[t[0]];
    rt.batchDrawFrame(tex, frameIndex(sc, tex, t[1], t[2], 16), dx + x * 16, dy + y * 16);
  }
}

/** objects sorted by foot (same rule as tools/render_generated.py); ghost: building parts above their footprint drawn translucent */
export function drawObjects(sc: Phaser.Scene, rt: Phaser.GameObjects.RenderTexture, objects: Placed[], ghost: boolean,
  dx = 0, dy = 0): void {
  const objs = [...objects].sort((a, b) => a.foot - b.foot || (a.sub ?? 0) - (b.sub ?? 0));
  for (const o of objs) {
    const ox = dx + o.x, oy = dy + o.y;
    if (o.kind === 'sprite') {
      const cut = o.solid === undefined ? 0 : Math.max(0, Math.min(o.h, o.solid - o.y));
      if (o.clip) rt.batchDrawFrame(o.file, region(sc, o.file, ...o.clip), ox, oy);   // exp-09: part of a sprite
      else if (!ghost || cut <= 0) rt.batchDrawFrame(o.file, '__BASE', ox, oy);
      else {
        rt.batchDrawFrame(o.file, band(sc, o.file, 0, cut), ox, oy, 0.28);
        if (cut < o.h) rt.batchDrawFrame(o.file, band(sc, o.file, cut, o.h), ox, oy + cut);
      }
    } else for (const l of o.layers ?? []) rt.batchDrawFrame(l, frameIndex(sc, l, o.frame![0], o.frame![1], 16), ox, oy);
  }
}
