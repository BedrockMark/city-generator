// Phaser viewer: generate a block from a seed, render it, pan/zoom, regenerate, export PNG + scene JSON.
// Annotation mode (A): group / zone / building layers, hover + click details, good / bad labels (src/viewer).
// Heat map (H): the judge's oddness per window (stage 6). Generation runs in a worker (src/viewer/gen.worker.ts):
// the judge repair (exp-02) regenerates the map many times and shows its progress.
import Phaser from 'phaser';
import { VERSION } from './gen/generate';
import { EXPERIMENTS, DEFAULT_OPTIONS, withDefaults } from './gen/exp';
import type { Scene as GenScene, GenOptions, Placed, PxRect } from './gen/types';
import { drawOverlay, pick, zonesAt, objBox, hiddenObjects, buildingOf, typeColor, zoneColor, zoneKey, intersects, ZONE_LAYER_NAMES, type OverlayState, type Sel } from './viewer/overlay';
import { LabelStore, GOOD_TAGS, BAD_TAGS, sceneStem, type Label, type LabelTarget } from './viewer/labels';
import { drawHeat, heatAt, reasons } from './viewer/heat';

const ASSET_ROOT = 'assets/';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const CELL_NAMES: Record<string, string> = { road: '马路', walk: '主街区人行道', lot: '主街区内部', nwalk: '邻近街区人行道', nlot: '邻近街区地块（画面外的街区，只铺地）' };

function toast(msg: string) {
  const t = $('toast'); t.textContent = msg; t.style.display = 'block';
  clearTimeout((toast as unknown as { h: number }).h);
  (toast as unknown as { h: number }).h = window.setTimeout(() => { t.style.display = 'none'; }, 2500);
}

class CityView extends Phaser.Scene {
  private world?: Phaser.GameObjects.RenderTexture;
  private gridGfx?: Phaser.GameObjects.Graphics;
  private current?: GenScene;
  private source = '';
  private drag?: { x: number; y: number; sx: number; sy: number; box?: { x: number; y: number }; moved: boolean };
  private opts: GenOptions = withDefaults();
  private anno = false;
  private ov: OverlayState = { layers: { groups: true, zones: false, buildings: false, labels: true, audit: true }, hiddenTypes: new Set(), hiddenZones: new Set(), ghost: false, labels: [] };
  private hidden = new Set<string>();
  private store?: LabelStore;
  private verdict: 'good' | 'bad' | null = null;
  private tags = new Set<string>();
  private lastView = '';
  private dirty = true;
  /** heat map layer (H) and the world point under the mouse */
  private heat = false;
  private heatHover?: { x: number; y: number; sx: number; sy: number };
  private worker?: Worker;
  private busy = false;
  private reqId = 0;
  private reqT0 = 0;

  constructor() { super('city'); }

  create() {
    const cam = this.cameras.main;
    cam.setBackgroundColor('#1d1d24');
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      const shift = (p.event as MouseEvent).shiftKey;
      this.drag = { x: p.x, y: p.y, sx: cam.scrollX, sy: cam.scrollY, moved: false, box: this.anno && shift ? { x: p.worldX, y: p.worldY } : undefined };
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      const d = this.drag; this.drag = undefined;
      if (!d || !this.anno || !this.current) return;
      if (d.box && this.ov.box && this.ov.box.x1 - this.ov.box.x0 >= 4 && this.ov.box.y1 - this.ov.box.y0 >= 4) { this.select({ kind: 'region', rect: this.ov.box }); this.ov.box = undefined; return; }
      this.ov.box = undefined;
      if (!d.moved) this.select(this.selAt(p.worldX, p.worldY));
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.drag && p.isDown) {
        if (Math.abs(p.x - this.drag.x) + Math.abs(p.y - this.drag.y) > 4) this.drag.moved = true;
        if (this.drag.box) {
          const b = this.drag.box;
          this.ov.box = { x0: Math.min(b.x, p.worldX), y0: Math.min(b.y, p.worldY), x1: Math.max(b.x, p.worldX), y1: Math.max(b.y, p.worldY) };
          this.dirty = true;
          return;
        }
        cam.scrollX = this.drag.sx - (p.x - this.drag.x) / cam.zoom;
        cam.scrollY = this.drag.sy - (p.y - this.drag.y) / cam.zoom;
        return;
      }
      if (this.anno && this.current) { this.ov.hover = this.selAt(p.worldX, p.worldY); if (!this.ov.pinned) this.showDetail(this.ov.hover); this.dirty = true; }
      if (this.heat && this.current) { this.heatHover = { x: p.worldX, y: p.worldY, sx: p.x, sy: p.y }; this.showHeatTip(); }
    });
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => this.zoomBy(dy > 0 ? 1 / 1.25 : 1.25));
    const url = new URL(location.href);
    const nov = url.searchParams.get('nov'), xm = url.searchParams.get('x'), ex = url.searchParams.get('e');
    if (nov !== null) this.opts.novelty = Math.max(0, Math.min(1, +nov || 0));
    if (xm !== null) this.opts.experiments = xm !== '0';
    if (ex) for (const kv of ex.split(',')) { const [k, v] = kv.split(':'); if (k) this.opts.exp[k] = v !== '0'; }
    if (url.searchParams.get('pd') !== null) this.opts.pruneDraft = url.searchParams.get('pd') !== '0';
    if (url.searchParams.get('p') !== null) this.opts.prune = url.searchParams.get('p') !== '0';
    if (url.searchParams.get('jg') !== null) this.opts.judgeGlobal = url.searchParams.get('jg') !== '0';
    $<HTMLInputElement>('pruneDraft').checked = this.opts.pruneDraft;
    $<HTMLInputElement>('pruneDraft').onchange = () => { this.opts.pruneDraft = $<HTMLInputElement>('pruneDraft').checked; this.reload(); };
    $<HTMLInputElement>('novelty').value = String(this.opts.novelty);
    $('noveltyVal').textContent = this.opts.novelty.toFixed(2);
    this.buildExpMenu();
    this.load_(url.searchParams.get('seed') ?? String(Math.floor(Math.random() * 1e6)));
    $('go').onclick = () => this.load_($<HTMLInputElement>('seed').value.trim() || '1');
    $('seed').onkeydown = (e) => { if ((e as KeyboardEvent).key === 'Enter') $('go').click(); };
    $('regen').onclick = () => this.load_(String(Math.floor(Math.random() * 1e6)));
    $('zin').onclick = () => this.zoomBy(1.25);
    $('zout').onclick = () => this.zoomBy(1 / 1.25);
    $('fit').onclick = () => this.fit();
    $('grid').onchange = () => this.gridGfx?.setVisible($<HTMLInputElement>('grid').checked);
    $('ghost').onchange = () => { if (this.current) this.draw(this.current, false); };
    $('export').onclick = () => this.exportShot();
    $('anno').onclick = () => this.toggleAnno();
    $('heat').onclick = () => this.toggleHeat();
    $<HTMLInputElement>('novelty').oninput = () => { $('noveltyVal').textContent = (+$<HTMLInputElement>('novelty').value).toFixed(2); };
    $<HTMLInputElement>('novelty').onchange = () => { this.opts.novelty = +$<HTMLInputElement>('novelty').value; this.reload(); };
    $('expbtn').onclick = () => { const m = $('expmenu'); m.style.left = `${$('expbtn').getBoundingClientRect().left}px`; m.classList.toggle('open'); };
    for (const [id, k] of [['lyGroups', 'groups'], ['lyZones', 'zones'], ['lyBuildings', 'buildings'], ['lyLabels', 'labels'], ['lyAudit', 'audit']] as const)
      $<HTMLInputElement>(id).onchange = () => { this.ov.layers[k] = $<HTMLInputElement>(id).checked; $('zoneLegendSec').style.display = this.ov.layers.zones ? '' : 'none'; this.dirty = true; };
    $('grpAll').onclick = () => { this.ov.hiddenTypes.clear(); this.buildLegend(); this.dirty = true; };
    $('grpNone').onclick = () => { for (const g of this.current?.groups ?? []) this.ov.hiddenTypes.add(g.type); this.buildLegend(); this.dirty = true; };
    $('lblGood').onclick = () => this.setVerdict('good');
    $('lblBad').onclick = () => this.setVerdict('bad');
    $('lblSave').onclick = () => this.saveLabel();
    window.addEventListener('keydown', (e) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'TEXTAREA' && e.key === 'Enter' && e.ctrlKey) { this.saveLabel(); return; }
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const k = e.key.toLowerCase();
      if (k === 'r') $('regen').click();
      if (k === 'f') this.fit();
      if (k === 'e') this.exportShot();
      if (k === 'a') this.toggleAnno();
      if (k === 'h') this.toggleHeat();
      if (k === 'g') { const g = $<HTMLInputElement>('ghost'); g.checked = !g.checked; g.onchange?.(new Event('change')); }
      if (this.anno && k === '1') this.setVerdict('good');
      if (this.anno && k === '2') this.setVerdict('bad');
      if (k === 'escape') { this.ov.pinned = undefined; this.showDetail(this.ov.hover); this.updateForm(); this.dirty = true; $('expmenu').classList.remove('open'); }
    });
    // drop a scene JSON (an export or a labelled sample) to view it as it was saved
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      const f = e.dataTransfer?.files[0];
      if (!f) return;
      try { const sc = JSON.parse(await f.text()) as GenScene; if (!sc.objects || !sc.ground) throw new Error('不是 scene JSON'); this.show(sc, 0, f.name); }
      catch (err) { toast(`无法读取 ${f.name}: ${err}`); }
    });
    this.scale.on('resize', () => this.fit());
  }

  update() {
    const c = $<HTMLCanvasElement>('overlay');
    const game = this.game.canvas;
    if (c.width !== game.clientWidth || c.height !== game.clientHeight) { c.width = game.clientWidth; c.height = game.clientHeight; this.dirty = true; }
    const cam = this.cameras.main;
    const v = this.view();
    const key = `${v.s}|${v.ox}|${v.oy}|${this.anno}|${this.heat}|${cam.width}`;
    if (key === this.lastView && !this.dirty) return;
    this.lastView = key; this.dirty = false;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    if (this.heat && this.current) drawHeat(ctx, this.current, v);
    if (this.anno && this.current) { this.ov.ghost = $<HTMLInputElement>('ghost').checked; drawOverlay(ctx, this.current, v, this.ov); }
  }

  private toggleHeat() {
    this.heat = !this.heat;
    $('heat').classList.toggle('on', this.heat);
    if (!this.heat) { this.heatHover = undefined; $('heatTip').style.display = 'none'; }
    this.dirty = true;
  }

  /** hover tooltip of the heat map: the score of the oddest window under the mouse and its 3 main reasons */
  private showHeatTip() {
    const tip = $('heatTip'), h = this.heatHover, sc = this.current;
    const w = h && sc ? heatAt(sc, h.x, h.y) : undefined;
    if (!w || !h || !sc) { tip.style.display = 'none'; return; }
    const rep = sc.judgeRepair?.windows.find(r => r.rect.x0 === w.rect.x0 && r.rect.y0 === w.rect.y0);
    tip.innerHTML = `<b>怪异分 ${w.score.toFixed(2)}</b>${w.score > (sc.judge?.threshold ?? 1) ? '（超过阈值）' : ''}${rep ? `<br/>修复：${rep.before.toFixed(2)} → ${rep.after.toFixed(2)}` : ''}<br/>${reasons(w).map(esc).join('<br/>')}`;
    const g = $('game').getBoundingClientRect();
    tip.style.left = `${g.left + h.sx + 14}px`; tip.style.top = `${g.top + h.sy + 14}px`; tip.style.display = 'block';
  }

  /** world px -> overlay px, matching the main camera (zoom about the viewport centre) */
  private view() {
    const cam = this.cameras.main, z = cam.zoom;
    return { s: z, ox: cam.scrollX + cam.width / 2 - cam.width / (2 * z), oy: cam.scrollY + cam.height / 2 - cam.height / (2 * z) };
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

  private reload() { if (this.current && !this.source) this.load_(this.current.seed); }

  private load_(seed: string) {
    $<HTMLInputElement>('seed').value = seed;
    const q = new URLSearchParams({ seed });
    if (this.opts.novelty !== DEFAULT_OPTIONS.novelty) q.set('nov', String(this.opts.novelty));
    if (!this.opts.experiments) q.set('x', '0');
    const e = Object.entries(this.opts.exp).map(([k, v]) => `${k}:${v ? 1 : 0}`).join(',');
    if (e) q.set('e', e);
    if (this.opts.pruneDraft) q.set('pd', '1');
    if (!this.opts.prune) q.set('p', '0');
    if (this.opts.judgeGlobal) q.set('jg', '1');
    history.replaceState(null, '', `?${q}`);
    // a request while the worker is busy replaces it (the old result is no longer wanted)
    if (this.busy) { this.worker?.terminate(); this.worker = undefined; }
    const id = ++this.reqId;
    this.reqT0 = performance.now(); this.busy = true;
    $('info').textContent = `生成中… seed ${seed}`;
    this.genWorker().postMessage({ id, seed, opts: this.opts });
  }

  private genWorker(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('./viewer/gen.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<{ id: number; progress?: [number, number]; scene?: GenScene; error?: string }>) => {
      const d = e.data;
      if (d.id !== this.reqId) return;
      if (d.progress) { $('info').textContent = `评判修复中…（${d.progress[0]} / ${d.progress[1]}）`; return; }
      this.busy = false;
      if (d.error) { toast(`生成失败：${d.error}`); return; }
      this.show(d.scene!, performance.now() - this.reqT0, '');
    };
    return (this.worker = w);
  }

  private show(sc: GenScene, ms: number, source: string) {
    const refit = !this.current || this.current.cols !== sc.cols || this.current.rows !== sc.rows || !!source || !!this.source;
    sc.objects.forEach((o, i) => { o.id ??= `o${i}`; });   // scenes saved before v0.4.0 have no ids
    this.current = sc; this.source = source;
    this.hidden = hiddenObjects(sc);
    this.ov.hover = undefined; this.ov.pinned = undefined;
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
    const o = sc.options;
    const au = sc.audit;
    const optInfo = (o ? ` · 创新度 ${o.novelty.toFixed(2)} · 实验${o.experiments ? '开' : '关'}` : '')
      + (sc.judge ? ` · 怪异分 均 ${sc.judge.mean.toFixed(2)} / 最高 ${sc.judge.max.toFixed(2)}` : '')
      + (sc.judgeRepair ? ` · 评判修复 ${sc.judgeRepair.windows.filter(w => w.adopted !== undefined).length} 换盐 / ${sc.judgeRepair.windows.filter(w => w.degraded && w.degraded !== 'rejected').length} 降级${sc.judgeRepair.globalAdopted !== undefined ? ' / 整体档' : ''}（${sc.judgeRepair.meanBefore.toFixed(2)} → ${sc.judgeRepair.meanAfter.toFixed(2)}）` : sc.options?.judgeFixed ? ' · 评判修复（按记录重建）' : '')
      + (au ? ` · 约束违规 ${au.violations.length}${au.pruned.length || au.downgraded.length || au.regrounded?.length ? ` · 剪掉 ${au.pruned.length} 个物件、降级 ${au.downgraded.length} 块、改地面 ${au.regrounded?.length ?? 0} 处` : ''}${o?.pruneDraft ? '（修复预览）' : ''}` : '');
    const done = () => {
      this.draw(sc, refit);
      $('info').textContent = `${source ? `文件 ${source} · ` : ''}v${sc.version} · seed ${sc.seed} · ${sc.cols}×${sc.rows} 格 · 内部 ${(sc.params.interior as number[]).join('×')} · ${sc.params.shape} · ${sc.objects.length} 物件${optInfo}${ms ? ` · 生成 ${ms.toFixed(0)} ms` : ''}`;
    };
    if (queued) { this.load.once(Phaser.Loader.Events.COMPLETE, done); this.load.start(); } else done();
    this.buildLegend();
    this.showDetail(undefined);
    this.store = new LabelStore(sc.version, sc.seed);
    this.ov.labels = [];
    this.store.load().then(() => { this.ov.labels = this.store!.labels; this.renderLabelList(); this.updateForm(); this.dirty = true; });
    this.updateForm();
    this.dirty = true;
  }

  /** frame index of (col,row) in a sheet loaded with 16-px wide frames (sheet widths are not always multiples) */
  private frameIndex(tex: string, col: number, row: number, fw: number) {
    const w = this.textures.get(tex).source[0].width;
    return row * Math.floor(w / fw) + col;
  }

  /** sub-frame of an image texture (rows y0..y1), created on demand */
  private band(file: string, y0: number, y1: number): string {
    const tex = this.textures.get(file);
    const name = `band${y0}_${y1}`;
    if (!tex.has(name)) tex.add(name, 0, 0, y0, tex.source[0].width, y1 - y0);
    return name;
  }

  /** ground + objects into a render texture; ghost: building parts above their footprint drawn translucent */
  private render(sc: GenScene, ghost: boolean): Phaser.GameObjects.RenderTexture {
    const W = sc.cols * 16, H = sc.rows * 16;
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
      if (o.kind === 'sprite') {
        const cut = o.solid === undefined ? 0 : Math.max(0, Math.min(o.h, o.solid - o.y));
        if (!ghost || cut <= 0) rt.drawFrame(o.file, '__BASE', o.x, o.y);
        else {
          rt.drawFrame(o.file, this.band(o.file, 0, cut), o.x, o.y, 0.28);
          if (cut < o.h) rt.drawFrame(o.file, this.band(o.file, cut, o.h), o.x, o.y + cut);
        }
      } else for (const l of o.layers ?? []) rt.drawFrame(l, this.frameIndex(l, o.frame![0], o.frame![1], 16), o.x, o.y);
    }
    return rt;
  }

  private draw(sc: GenScene, refit = true) {
    const W = sc.cols * 16, H = sc.rows * 16;
    this.world?.destroy(); this.gridGfx?.destroy();
    const rt = this.render(sc, $<HTMLInputElement>('ghost').checked);
    this.world = rt;
    const g = this.add.graphics().setVisible($<HTMLInputElement>('grid').checked);
    g.lineStyle(1, 0xff00ff, 0.25);
    for (let x = 0; x <= sc.cols; x += 4) g.lineBetween(x * 16, 0, x * 16, H);
    for (let y = 0; y <= sc.rows; y += 4) g.lineBetween(0, y * 16, W, y * 16);
    this.gridGfx = g;
    if (refit) this.fit();
    this.dirty = true;
  }

  // ------------------------------------------------------------------------------------------------
  // annotation mode

  private toggleAnno() {
    this.anno = !this.anno;
    document.body.classList.toggle('anno', this.anno);
    $('anno').classList.toggle('on', this.anno);
    this.scale.refresh();
    this.dirty = true;
  }

  private selAt(x: number, y: number): Sel {
    const o = pick(this.current!, x, y, $<HTMLInputElement>('ghost').checked, this.hidden);
    return o ? { kind: 'object', id: o.id! } : { kind: 'point', x, y };
  }

  private select(s: Sel) {
    const same = this.ov.pinned && JSON.stringify(this.ov.pinned) === JSON.stringify(s);
    this.ov.pinned = same ? undefined : s;
    this.showDetail(this.ov.pinned ?? s);
    this.updateForm();
    this.dirty = true;
  }

  private buildExpMenu() {
    const m = $('expmenu');
    const rows = EXPERIMENTS.filter(e => e.status !== 'adopted').map(e =>
      `<label><input type="checkbox" data-exp="${e.id}" ${(this.opts.exp[e.id] ?? e.default) ? 'checked' : ''} ${e.status === 'retired' ? 'disabled' : ''}/> <b>${e.id}</b> ${esc(e.title)} <span class="mini">(${e.status === 'retired' ? '已废弃' : '实验'})</span></label>`).join('');
    m.innerHTML = `<label><input type="checkbox" id="expAll" ${this.opts.experiments ? 'checked' : ''}/> <b>启用实验功能（总开关）</b></label><hr style="border-color:#444"/>`
      + (rows || '<div class="mini">暂无实验功能。第一个实验功能将登记为 exp-01（见 docs/EXPERIMENTS.md）。</div>');
    $<HTMLInputElement>('expAll').onchange = () => { this.opts.experiments = $<HTMLInputElement>('expAll').checked; this.reload(); };
    m.querySelectorAll<HTMLInputElement>('input[data-exp]').forEach(i => { i.onchange = () => { this.opts.exp[i.dataset.exp!] = i.checked; this.reload(); }; });
  }

  private buildLegend() {
    const sc = this.current; if (!sc) return;
    const cnt = new Map<string, number>();
    for (const g of sc.groups ?? []) if (g.members.length && g.type !== 'bld') cnt.set(g.type, (cnt.get(g.type) ?? 0) + 1);
    $('legendGroups').innerHTML = [...cnt].sort().map(([t, n]) =>
      `<label><input type="checkbox" data-t="${esc(t)}" ${this.ov.hiddenTypes.has(t) ? '' : 'checked'}/><span class="sw" style="background:${typeColor(t)}"></span>${esc(t)}<span class="cnt">${n}</span></label>`).join('');
    $('legendGroups').querySelectorAll<HTMLInputElement>('input').forEach(i => { i.onchange = () => { if (i.checked) this.ov.hiddenTypes.delete(i.dataset.t!); else this.ov.hiddenTypes.add(i.dataset.t!); this.dirty = true; }; });
    const zc = new Map<string, { n: number; z: NonNullable<GenScene['zones']>[number] }>();
    for (const z of sc.zones ?? []) { const k = zoneKey(z); zc.set(k, { n: (zc.get(k)?.n ?? 0) + 1, z }); }
    $('legendZones').innerHTML = [...zc].sort().map(([k, { n, z }]) =>
      `<label title="${esc(ZONE_LAYER_NAMES[z.layer])}"><input type="checkbox" data-z="${esc(k)}" ${this.ov.hiddenZones.has(k) ? '' : 'checked'}/><span class="sw" style="background:${zoneColor(z)}"></span>${esc(k)}<span class="cnt">${n}</span></label>`).join('');
    $('legendZones').querySelectorAll<HTMLInputElement>('input').forEach(i => { i.onchange = () => { if (i.checked) this.ov.hiddenZones.delete(i.dataset.z!); else this.ov.hiddenZones.add(i.dataset.z!); this.dirty = true; }; });
  }

  private thumb(o: Placed): string {
    if (o.kind === 'sprite') return `<img id="thumb" src="${ASSET_ROOT}${esc(o.file)}" />`;
    const [c, r] = o.frame ?? [0, 0];
    return `<span class="char">${(o.layers ?? []).map(l => `<div style="background:url('${ASSET_ROOT}${esc(l)}') -${c * 16}px -${r * 32}px"></div>`).join('')}</span>`;
  }

  private showDetail(s: Sel | undefined) {
    const el = $('detailBody'), sc = this.current;
    if (!s || !sc) { el.innerHTML = '把鼠标移到物件、建筑或空地上。'; return; }
    const row = (k: string, v: string) => `<tr><td>${k}</td><td>${v}</td></tr>`;
    if (s.kind === 'object') {
      const o = sc.objects.find(x => x.id === s.id)!;
      const g = sc.groups?.find(x => x.gid === o.gid);
      const b = buildingOf(sc, o);
      const a = o.anchor;
      let h = `<div class="row">${b ? '' : this.thumb(o)}<div><b>${esc(o.key.split('/').pop())}</b><br/><span class="mini">${esc(o.cls)} · ${esc(o.id)}${this.hidden.has(o.id!) ? ' · 被楼挡住' : ''}</span></div></div><table>`;
      if (o.exp) h += row('实验', `<span class="exp">${esc(o.exp)}</span>`);
      if (o.novel) h += row('新贴图', '<span style="color:#00e5ff">是（少用 / 未用过的贴图）</span>');
      h += row('原因', esc(o.reason));
      h += row('小组', `<span class="sw" style="background:${typeColor(g?.type ?? '')}"></span>${esc(o.gid)}${g ? ` <span class="mini">(${g.members.length} 个成员)</span>` : ''}`);
      if (g && g.reason !== o.reason) h += row('触发', esc(g.reason));
      if (a) h += row('锚点', `${esc(a.kind)}: ${esc(a.ref)} <span class="mini">(${Math.round(a.x)}, ${Math.round(a.y)})</span>`);
      if (b) {
        h += row('建筑', `${esc(b.label)} · ${esc(b.front)} · ${b.block === 'main' ? '主街区' : '邻近街区'} · 立面朝${b.side === 'S' ? '街' : '内院'}`);
        h += row('外框', `${b.rect.x1 - b.rect.x0}×${b.rect.y1 - b.rect.y0}px，碰撞体积 ${b.solid.x1 - b.solid.x0}×${b.solid.y1 - b.solid.y0}px（屋顶大小），门 ${b.doors.length} 个`);
      }
      for (const v of sc.audit?.violations.filter(v => v.target === o.id || v.objs.includes(o.id!)) ?? []) h += row(`<span style="color:#e53935">${esc(v.c)}</span>`, esc(v.msg));
      h += row('精灵', `<span class="mini">${esc(o.key)}</span>`);
      h += row('位置', `<span class="mini">x ${o.x} y ${o.y} · foot ${o.foot}</span>`);
      el.innerHTML = h + '</table>';
    } else if (s.kind === 'point') {
      const zs = zonesAt(sc, s.x, s.y);
      const cell = sc.cells[Math.floor(s.y / 16)]?.[Math.floor(s.x / 16)];
      let h = `<b>这里为什么是空的</b> <span class="mini">(${Math.round(s.x)}, ${Math.round(s.y)}) · ${esc(CELL_NAMES[cell] ?? cell)}</span><table>`;
      for (const z of zs) h += row(`<span class="sw" style="background:${zoneColor(z)}"></span>${esc(ZONE_LAYER_NAMES[z.layer])}`, `${z.exp ? `<span class="exp">[${esc(z.exp)}]</span> ` : ''}${esc(z.reason)}${z.gid ? ` <span class="mini">${esc(z.gid)}</span>` : ''}`);
      if (!zs.length) h += row('', '没有登记的区域：' + esc(CELL_NAMES[cell] ?? cell));
      const au = sc.audit;
      for (const p of au?.pruned.filter(p => s.x >= p.x && s.x < p.x + p.w && s.y >= p.y && s.y < p.y + p.h) ?? []) h += row(`<span style="color:#bdbdbd">删 ${esc(p.c)}</span>`, `${esc(p.key.split('/').pop())}（${esc(p.gid)}）：${esc(p.msg)}`);
      for (const d of au?.downgraded.filter(d => s.x >= d.rect.x0 && s.x < d.rect.x1 && s.y >= d.rect.y0 && s.y < d.rect.y1) ?? []) h += row(`<span style="color:#8e24aa">降级 ${esc(d.c)}</span>`, esc(d.msg));
      for (const g of au?.regrounded?.filter(g => s.x >= g.rect.x0 && s.x < g.rect.x1 && s.y >= g.rect.y0 && s.y < g.rect.y1) ?? []) h += row(`<span style="color:#26a69a">地面 ${esc(g.c)}</span>`, esc(g.msg));
      for (const v of au?.violations.filter(v => s.x >= v.rect.x0 && s.x < v.rect.x1 && s.y >= v.rect.y0 && s.y < v.rect.y1) ?? []) h += row(`<span style="color:#e53935">${esc(v.c)}</span>`, esc(v.msg));
      el.innerHTML = h + '</table>';
    } else {
      const t = this.target(s);
      const types = new Map<string, number>();
      for (const gid of t.gids) { const ty = sc.groups?.find(g => g.gid === gid)?.type ?? '?'; types.set(ty, (types.get(ty) ?? 0) + 1); }
      el.innerHTML = `<b>框选区域</b> <span class="mini">${Math.round(s.rect.x1 - s.rect.x0)}×${Math.round(s.rect.y1 - s.rect.y0)}px</span><table>`
        + row('物件', String(t.objects.length)) + row('小组', [...types].map(([k, n]) => `${esc(k)}×${n}`).join('、') || '无')
        + row('区域', String(t.zones.length)) + '</table>';
    }
  }

  // ---- labels ----

  private target(s: Sel): LabelTarget {
    const sc = this.current!;
    const snap = (o: Placed) => ({ id: o.id!, key: o.key, cls: o.cls, gid: o.gid, x: o.x, y: o.y });
    let rect: PxRect, objs: Placed[], kind: LabelTarget['kind'];
    if (s.kind === 'object') {
      const o = sc.objects.find(x => x.id === s.id)!;
      const b = buildingOf(sc, o);
      kind = b ? 'building' : 'object';
      rect = b ? b.rect : objBox(o);
      objs = b ? sc.objects.filter(x => x.gid === o.gid) : [o];
    } else {
      rect = s.kind === 'region' ? s.rect : { x0: Math.floor(s.x / 16) * 16, y0: Math.floor(s.y / 16) * 16, x1: Math.floor(s.x / 16) * 16 + 16, y1: Math.floor(s.y / 16) * 16 + 16 };
      kind = 'region';
      // objects standing in the region (box centre inside); buildings whose footprint overlaps it
      objs = sc.objects.filter(o => {
        if (o.cls === 'building') { const b = buildingOf(sc, o); return !!b && intersects(b.solid, rect); }
        const b = objBox(o), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
        return cx >= rect.x0 && cx < rect.x1 && cy >= rect.y0 && cy < rect.y1;
      });
    }
    return { kind, rect: { ...rect }, objects: objs.map(snap), gids: [...new Set(objs.map(o => o.gid).filter((g): g is string => !!g))], zones: (sc.zones ?? []).filter(z => intersects(z.rect, rect)).map(z => z.id) };
  }

  private setVerdict(v: 'good' | 'bad') {
    if (!this.ov.pinned) { toast('先单击或框选要标注的物件 / 区域'); return; }
    if (this.verdict !== v) this.tags.clear();
    this.verdict = v;
    this.updateForm();
  }

  private updateForm() {
    const s = this.ov.pinned;
    $('lblTarget').textContent = !s ? '（未选择）' : s.kind === 'object' ? this.current?.objects.find(o => o.id === s.id)?.gid ?? s.id : s.kind === 'region' ? '框选区域' : '空地一格';
    $('lblGood').classList.toggle('on', this.verdict === 'good');
    $('lblBad').classList.toggle('on', this.verdict === 'bad');
    const box = $('lblTags');
    box.className = this.verdict ?? '';
    const tags = this.verdict === 'good' ? GOOD_TAGS : this.verdict === 'bad' ? BAD_TAGS : [];
    box.innerHTML = tags.map(t => `<span class="chip ${this.tags.has(t) ? 'on' : ''}" data-t="${esc(t)}">${esc(t)}</span>`).join('');
    box.querySelectorAll<HTMLElement>('.chip').forEach(c => { c.onclick = () => { const t = c.dataset.t!; if (this.tags.has(t)) this.tags.delete(t); else this.tags.add(t); this.updateForm(); }; });
    $('lblStore').textContent = this.store ? (this.store.mode === 'server' ? '保存到 references/labels/' : '开发服务器不可用：暂存浏览器') : '';
  }

  private async saveLabel() {
    const sc = this.current, s = this.ov.pinned;
    if (!sc || !s || !this.store) { toast('先单击或框选要标注的物件 / 区域'); return; }
    if (!this.verdict) { toast('先选“好”或“坏”'); return; }
    const o = sc.options ?? withDefaults();
    const l: Label = { id: this.store.nextId(), created: new Date().toISOString(), version: sc.version, seed: sc.seed, novelty: o.novelty, options: o, scene: `${sceneStem(sc)}.scene.json`,
      verdict: this.verdict, tags: [...this.tags], text: $<HTMLTextAreaElement>('lblText').value.trim(), target: this.target(s) };
    await this.store.add(l, sc);
    this.ov.labels = this.store.labels;
    $<HTMLTextAreaElement>('lblText').value = ''; this.tags.clear(); this.verdict = null;
    this.ov.pinned = undefined;
    this.updateForm(); this.renderLabelList(); this.dirty = true;
    toast(`已保存标注 ${l.id}（${this.store.mode === 'server' ? 'references/labels/' : '浏览器暂存'}）`);
  }

  private renderLabelList() {
    const ls = this.store?.labels ?? [];
    $('lblCount').textContent = `${ls.length} 条`;
    const cur = this.current?.options;
    $('lblList').innerHTML = ls.map(l => {
      const other = cur && JSON.stringify(l.options) !== JSON.stringify(cur) ? ' <span class="mini">(其他参数)</span>' : '';
      return `<div data-id="${l.id}"><button data-del="${l.id}">删除</button><span class="${l.verdict === 'good' ? 'g' : 'b'}">${l.verdict === 'good' ? '✓' : '✗'}</span> ${l.id} · ${esc(l.target.kind)} ${esc(l.target.gids.slice(0, 2).join(','))}${other}<br/><span class="mini">${esc(l.tags.join('、'))} ${esc(l.text)}</span></div>`;
    }).join('');
    $('lblList').querySelectorAll<HTMLElement>('div[data-id]').forEach(d => { d.onclick = () => { const l = ls.find(x => x.id === d.dataset.id); if (l) { this.ov.pinned = { kind: 'region', rect: l.target.rect }; this.showDetail(this.ov.pinned); this.dirty = true; } }; });
    $('lblList').querySelectorAll<HTMLButtonElement>('button[data-del]').forEach(b => { b.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`删除标注 ${b.dataset.del}？`)) return;
      await this.store!.remove(b.dataset.del!, this.current!); this.ov.labels = this.store!.labels; this.renderLabelList(); this.dirty = true;
    }; });
  }

  // ------------------------------------------------------------------------------------------------

  private exportShot() {
    if (!this.world || !this.current) return;
    const sc = this.current;
    const base = `citygen_v${sc.version}_${sceneStem(sc)}`;
    const files: [Blob | (() => Promise<Blob>), string][] = [];
    const png = (c: HTMLCanvasElement) => new Promise<Blob>(res => c.toBlob(b => res(b!), 'image/png'));
    const snap = (rt: Phaser.GameObjects.RenderTexture) => new Promise<HTMLImageElement>(res => rt.snapshot(img => { res(img as HTMLImageElement); rt.destroy(); }));
    const scaled = (im: HTMLImageElement, S: number) => {
      const c = document.createElement('canvas');
      c.width = im.width * S; c.height = im.height * S;
      const ctx = c.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(im, 0, 0, c.width, c.height);
      return c;
    };
    // normal + ghost view (both independent of the on-screen toggle); annotated = normal view + the annotation
    // layers as currently shown (groups / zones / buildings) + all labels
    const normal = snap(this.render(sc, false).setVisible(false)), ghost = snap(this.render(sc, true).setVisible(false));
    files.push([async () => png(scaled(await normal, 2)), `${base}.png`]);
    files.push([async () => png(scaled(await ghost, 2)), `${base}_ghost.png`]);
    files.push([async () => {
      const c = scaled(await normal, 3);
      const st: OverlayState = { ...this.ov, layers: { ...this.ov.layers, labels: true }, hover: undefined, box: undefined, ghost: false };
      if (!this.anno) st.layers = { groups: true, zones: false, buildings: false, labels: true, audit: true };
      drawOverlay(c.getContext('2d')!, sc, { s: 3, ox: 0, oy: 0 }, st);
      return png(c);
    }, `${base}_annotated.png`]);
    if (this.heat) files.push([async () => {
      const c = scaled(await normal, 2);
      drawHeat(c.getContext('2d')!, sc, { s: 2, ox: 0, oy: 0 });
      return png(c);
    }, `${base}_heat.png`]);
    files.push([new Blob([JSON.stringify(sc)], { type: 'application/json' }), `${base}.json`]);
    const labels = this.store?.labels ?? [];
    if (labels.length) files.push([new Blob([JSON.stringify({ version: sc.version, seed: sc.seed, labels }, null, 1)], { type: 'application/json' }), `${base}_labels.json`]);
    (window as unknown as { __exportCount: number }).__exportCount = files.length;
    (async () => { for (const [b, name] of files) download(typeof b === 'function' ? await b() : b, name); })();
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
