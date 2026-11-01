// Phaser viewer: generate a block from a seed, render it, pan/zoom, regenerate, export PNG + scene JSON.
import Phaser from 'phaser';
import { generate, VERSION } from './gen/generate';
import type { Scene as GenScene } from './gen/types';

const ASSET_ROOT = 'assets/';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

class CityView extends Phaser.Scene {
  private world?: Phaser.GameObjects.RenderTexture;
  private gridGfx?: Phaser.GameObjects.Graphics;
  private current?: GenScene;
  private drag?: { x: number; y: number; sx: number; sy: number };

  constructor() { super('city'); }

  create() {
    const cam = this.cameras.main;
    cam.setBackgroundColor('#1d1d24');
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => { this.drag = { x: p.x, y: p.y, sx: cam.scrollX, sy: cam.scrollY }; });
    this.input.on('pointerup', () => { this.drag = undefined; });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.drag || !p.isDown) return;
      cam.scrollX = this.drag.sx - (p.x - this.drag.x) / cam.zoom;
      cam.scrollY = this.drag.sy - (p.y - this.drag.y) / cam.zoom;
    });
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => this.zoomBy(dy > 0 ? 1 / 1.25 : 1.25));
    const url = new URL(location.href);
    this.load_(url.searchParams.get('seed') ?? String(Math.floor(Math.random() * 1e6)));
    $('go').onclick = () => this.load_($<HTMLInputElement>('seed').value.trim() || '1');
    $('seed').onkeydown = (e) => { if ((e as KeyboardEvent).key === 'Enter') $('go').click(); };
    $('regen').onclick = () => this.load_(String(Math.floor(Math.random() * 1e6)));
    $('zin').onclick = () => this.zoomBy(1.25);
    $('zout').onclick = () => this.zoomBy(1 / 1.25);
    $('fit').onclick = () => this.fit();
    $('grid').onchange = () => this.gridGfx?.setVisible($<HTMLInputElement>('grid').checked);
    $('export').onclick = () => this.exportShot();
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'r' || e.key === 'R') $('regen').click();
      if (e.key === 'f' || e.key === 'F') this.fit();
      if (e.key === 'e' || e.key === 'E') this.exportShot();
    });
    this.scale.on('resize', () => this.fit());
  }

  private zoomBy(f: number) {
    const cam = this.cameras.main;
    cam.setZoom(Phaser.Math.Clamp(cam.zoom * f, 0.25, 8));
  }

  private fit() {
    if (!this.current) return;
    const cam = this.cameras.main;
    const W = this.current.cols * 16, H = this.current.rows * 16;
    const z = Math.min(this.scale.width / W, this.scale.height / H);
    // integer zoom when possible keeps pixels crisp
    cam.setZoom(z >= 1 ? Math.floor(z) : z);
    cam.centerOn(W / 2, H / 2);
  }

  private load_(seed: string) {
    $<HTMLInputElement>('seed').value = seed;
    history.replaceState(null, '', `?seed=${encodeURIComponent(seed)}`);
    const t0 = performance.now();
    const sc = generate(seed);
    const ms = performance.now() - t0;
    this.current = sc;
    // queue every texture this scene needs that is not loaded yet
    const need = new Map<string, { kind: 'image' | 'sheet'; fw: number; fh: number }>();
    for (const k of Object.keys(sc.sheets)) need.set(sc.sheets[k as keyof typeof sc.sheets], { kind: 'sheet', fw: 16, fh: 16 });
    for (const o of sc.objects) {
      if (o.kind === 'sprite') need.set(o.file, { kind: 'image', fw: 0, fh: 0 });
      else for (const l of o.layers ?? []) need.set(l, { kind: 'sheet', fw: 16, fh: 32 });
    }
    let queued = 0;
    for (const [file, n] of need) {
      if (this.textures.exists(file)) continue;
      queued++;
      if (n.kind === 'image') this.load.image(file, ASSET_ROOT + file);
      else this.load.spritesheet(file, ASSET_ROOT + file, { frameWidth: n.fw, frameHeight: n.fh });
    }
    const done = () => { this.draw(sc); $('info').textContent = `v${VERSION} · seed ${seed} · ${sc.cols}×${sc.rows} 格 · 内部 ${(sc.params.interior as number[]).join('×')} · ${sc.params.shape} · ${sc.objects.length} 物件 · 生成 ${ms.toFixed(0)} ms`; };
    if (queued) { this.load.once(Phaser.Loader.Events.COMPLETE, done); this.load.start(); } else done();
  }

  /** frame index of (col,row) in a sheet loaded with 16-px wide frames (sheet widths are not always multiples) */
  private frameIndex(tex: string, col: number, row: number, fw: number) {
    const w = this.textures.get(tex).source[0].width;
    return row * Math.floor(w / fw) + col;
  }

  private draw(sc: GenScene) {
    const W = sc.cols * 16, H = sc.rows * 16;
    this.world?.destroy(); this.gridGfx?.destroy();
    const rt = this.add.renderTexture(0, 0, W, H).setOrigin(0, 0);
    // ground layers, then objects sorted by foot (same rule as tools/render_generated.py)
    for (const layer of sc.ground) for (let y = 0; y < sc.rows; y++) for (let x = 0; x < sc.cols; x++) {
      const t = layer[y][x];
      if (!t) continue;
      const tex = sc.sheets[t[0]];
      rt.drawFrame(tex, this.frameIndex(tex, t[1], t[2], 16), x * 16, y * 16);
    }
    const objs = [...sc.objects].sort((a, b) => a.foot - b.foot || (a.sub ?? 0) - (b.sub ?? 0));
    for (const o of objs) {
      if (o.kind === 'sprite') rt.drawFrame(o.file, undefined, o.x, o.y);
      else for (const l of o.layers ?? []) rt.drawFrame(l, this.frameIndex(l, o.frame![0], o.frame![1], 16), o.x, o.y);
    }
    this.world = rt;
    const g = this.add.graphics().setVisible($<HTMLInputElement>('grid').checked);
    g.lineStyle(1, 0xff00ff, 0.25);
    for (let x = 0; x <= sc.cols; x += 4) g.lineBetween(x * 16, 0, x * 16, H);
    for (let y = 0; y <= sc.rows; y += 4) g.lineBetween(0, y * 16, W, y * 16);
    this.gridGfx = g;
    this.fit();
  }

  private exportShot() {
    if (!this.world || !this.current) return;
    const sc = this.current;
    const base = `citygen_v${VERSION}_seed${sc.seed}`;
    this.world.snapshot((img) => {
      const im = img as HTMLImageElement;
      const S = 2;
      const c = document.createElement('canvas');
      c.width = im.width * S; c.height = im.height * S;
      const ctx = c.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(im, 0, 0, c.width, c.height);
      c.toBlob((b) => b && download(b, `${base}.png`), 'image/png');
      download(new Blob([JSON.stringify(sc)], { type: 'application/json' }), `${base}.json`);
    });
  }
}

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

new Phaser.Game({
  type: Phaser.WEBGL,
  parent: 'game',
  pixelArt: true,
  roundPixels: true,
  scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
  scene: [CityView],
});
