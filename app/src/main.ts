// Phaser viewer: generate a block from a seed, render it, pan/zoom, regenerate, export PNG + scene JSON.
// Annotation mode (A): group / zone / building layers, hover + click details, good / bad labels (src/viewer).
// Generation runs in a worker (src/viewer/gen.worker.ts). The A/B mode (stage 7) is archived in archive/ab/ (0.7.6).
// City mode (v0.8.1, URL city=1): the endless world streamed in chunks by src/viewer/city.ts; input is handed to it.
// Entering a city block (double-click / Enter) shows its full scene here like a single block (block view, body.cityblock):
// annotation and labels work as usual (label files keyed by storeKey); Esc goes back to the city.
import Phaser from 'phaser';
import { VERSION } from './gen/generate';
import { DEFAULT_OPTIONS, withDefaults } from './gen/exp';
import type { Scene as GenScene, GenOptions, Placed, PxRect } from './gen/types';
import { NOVEL_COLOR, drawOverlay, pick, zonesAt, objBox, hiddenObjects, buildingOf, typeColor, zoneColor, zoneKey, intersects, ZONE_LAYER_NAMES, type OverlayState, type Sel } from './viewer/overlay';
import { LabelStore, GOOD_TAGS, BAD_TAGS, sceneStem, storeKey, type Label, type LabelTarget } from './viewer/labels';
import type { Decision } from './gen/rng';
import { PREFS } from './gen/learn/prefs';
import { DISTRICTS, DISTRICT_KINDS, isDistrict, type DistrictKind } from './gen/district';
import { mixDistrict } from './viewer/mix';
import { ASSET_ROOT, loadTextures, drawGround, drawObjects } from './viewer/draw';
import { CityMode, parseCityUrl, toast, download, type CityUrl } from './viewer/city';
import { CITY_ZOOM } from './world/config';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const CELL_NAMES: Record<string, string> = { road: '马路', walk: '主街区人行道', lot: '主街区内部', nwalk: '邻近街区人行道', nlot: '邻近街区地块（画面外的街区，只铺地）' };
const randomSeed = () => String(Math.floor(Math.random() * 1e6));

class CityView extends Phaser.Scene {
  private world?: Phaser.GameObjects.RenderTexture;
  private gridGfx?: Phaser.GameObjects.Graphics;
  private current?: GenScene;
  private source = '';
  private drag?: { x: number; y: number; sx: number; sy: number; box?: { x: number; y: number }; moved: boolean };
  private opts: GenOptions = withDefaults();
  /** the district menu: '' = 普通街区 with the random mix (viewer/mix.ts), 'none' = 只要普通街区, or one kind. The generator
   *  gets the resolved kind (opts.district stays unset here) */
  private districtSel: '' | 'none' | DistrictKind = '';
  private anno = false;
  private ov: OverlayState = { layers: { groups: true, zones: false, buildings: false, labels: true, audit: true }, hiddenTypes: new Set(), hiddenZones: new Set(), ghost: false, labels: [] };
  private hidden = new Set<string>();
  private store?: LabelStore;
  private verdict: 'good' | 'bad' | null = null;
  private tags = new Set<string>();
  private lastView = '';
  private dirty = true;
  private worker?: Worker;
  private busy = false;
  /** the shown (requested) scene's district came from the random mix */
  private mixed = false;
  private reqId = 0;
  private reqT0 = 0;
  /** city mode (created on first use); the single-block camera is kept while the city is shown */
  private city?: CityMode;
  private cityOn = false;
  private singleCam?: { x: number; y: number; z: number };
  private lastClick = 0;
  /** block view: the city block shown, the city camera to go back to and the scene shown before (single-block mode) */
  private blockView?: { seed: string; id: string; cam: { x: number; y: number; z: number }; prev?: GenScene; prevSource: string };
  /** the city block being generated (a newer request, a new world or leaving the city drops its result) */
  private blockReq = 0;
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
      if (this.cityInput) { if (d) this.cityPointerUp(d.moved, p.worldX, p.worldY); return; }
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
      if (this.cityInput) { this.city!.pointerMove(p.worldX, p.worldY); return; }
      if (this.anno && this.current) { this.ov.hover = this.selAt(p.worldX, p.worldY); if (!this.ov.pinned) this.showDetail(this.ov.hover); this.dirty = true; }
    });
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => this.zoomBy(dy > 0 ? 1 / 1.25 : 1.25));
    const url = new URL(location.href);
    const nov = url.searchParams.get('nov');
    if (nov !== null) this.opts.novelty = Math.max(0, Math.min(1, +nov || 0));
    if (url.searchParams.get('p') !== null) this.opts.prune = url.searchParams.get('p') !== '0';
    if (url.searchParams.get('l') !== null) this.opts.prefs = url.searchParams.get('l') !== '0';
    // exp-08 特色街区 (adopted 0.7.8): 普通街区 = the viewer's random mix (one seed in five is a special district; the
    // generator itself never draws one, 0.7.8.2); 只要普通街区 = URL d=none
    const d = url.searchParams.get('d');
    if (isDistrict(d) || d === 'none') this.districtSel = d;
    const dSel = $<HTMLSelectElement>('district');
    dSel.innerHTML = `<option value="">普通街区</option><option value="none">只要普通街区</option>` + DISTRICT_KINDS.map(k => `<option value="${k}">${DISTRICTS[k].exp ? '[exp] ' : ''}${DISTRICTS[k].name}</option>`).join('');
    dSel.value = this.districtSel;
    dSel.onchange = () => { this.districtSel = isDistrict(dSel.value) || dSel.value === 'none' ? dSel.value : ''; this.reload(); };
    const prefsBox = $<HTMLInputElement>('prefs');
    prefsBox.checked = this.opts.prefs !== false;
    prefsBox.onchange = () => { this.opts.prefs = prefsBox.checked; this.reload(); };
    $<HTMLInputElement>('novelty').value = String(this.opts.novelty);
    $('noveltyVal').textContent = this.opts.novelty.toFixed(2);
    const cu = parseCityUrl(url.searchParams, randomSeed);
    if (cu) this.enterCity(cu);
    else this.load_(url.searchParams.get('seed') ?? randomSeed());
    const seedIn = () => $<HTMLInputElement>('seed').value.trim() || '1';
    $('mode').onclick = () => this.cityOn ? this.leaveCity() : this.enterCity({ seed: seedIn(), x: 0, y: 0, z: CITY_ZOOM.default });
    $('go').onclick = () => this.cityOn ? this.newWorld(seedIn()) : this.load_(seedIn());
    $('seed').onkeydown = (e) => { if ((e as KeyboardEvent).key === 'Enter') $('go').click(); };
    $('regen').onclick = () => this.cityOn ? this.newWorld(randomSeed()) : this.load_(randomSeed());
    $('zin').onclick = () => this.zoomBy(1.25);
    $('zout').onclick = () => this.zoomBy(1 / 1.25);
    $('fit').onclick = () => this.fit();
    $('grid').onchange = () => this.gridGfx?.setVisible($<HTMLInputElement>('grid').checked);
    $('ghost').onchange = () => { if (this.current) this.draw(this.current, false); };
    $('export').onclick = () => this.cityInput ? this.city!.exportShot() : this.exportShot();
    $('back').onclick = () => this.backToCity();
    $('anno').onclick = () => this.toggleAnno();
    $<HTMLInputElement>('novelty').oninput = () => { $('noveltyVal').textContent = (+$<HTMLInputElement>('novelty').value).toFixed(2); };
    $<HTMLInputElement>('novelty').onchange = () => { this.opts.novelty = +$<HTMLInputElement>('novelty').value; this.reload(); };
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
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const k = e.key.toLowerCase();
      if (this.cityInput) {
        if (k === 'r') $('regen').click();
        if (k === 'f') this.fit();
        if (k === 'e') this.city!.exportShot();
        if (k === 'enter') this.city!.enterSelected();
        if (k === 'escape') this.city!.clearSelection();
        return;
      }
      if (k === 'r' && !this.blockView) $('regen').click();
      if (k === 'f') this.fit();
      if (k === 'e') this.exportShot();
      if (k === 'a') this.toggleAnno();
      if (k === 'g') { const g = $<HTMLInputElement>('ghost'); g.checked = !g.checked; g.onchange?.(new Event('change')); }
      if (this.anno && k === '1') this.setVerdict('good');
      if (this.anno && k === '2') this.setVerdict('bad');
      if (k === 'escape' && this.blockView && !this.ov.pinned) { this.backToCity(); return; }
      if (k === 'escape') { this.ov.pinned = undefined; this.showDetail(this.ov.hover); this.updateForm(); this.dirty = true; }
    });
    // drop a scene JSON (an export or a labelled sample) to view it as it was saved
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      const f = e.dataTransfer?.files[0];
      if (!f) return;
      try {
        const sc = JSON.parse(await f.text()) as GenScene; if (!sc.objects || !sc.ground) throw new Error('不是 scene JSON');
        this.cancelGen();   // a generation still running must not replace the dropped file when it finishes
        if (this.cityOn) this.leaveCity(false);
        this.show(sc, 0, f.name);
      }
      catch (err) { toast(`无法读取 ${f.name}: ${err}`); }
    });
    this.scale.on('resize', () => { if (!this.cityInput) this.fit(); });
  }

  update() {
    const c = $<HTMLCanvasElement>('overlay');
    const game = this.game.canvas;
    if (c.width !== game.clientWidth || c.height !== game.clientHeight) { c.width = game.clientWidth; c.height = game.clientHeight; this.dirty = true; }
    if (this.cityInput) { this.city!.update(); return; }
    const cam = this.cameras.main;
    const v = this.view();
    const key = `${v.s}|${v.ox}|${v.oy}|${this.anno}|${cam.width}`;
    if (key === this.lastView && !this.dirty) return;
    this.lastView = key; this.dirty = false;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    if (this.anno && this.current) { this.ov.ghost = $<HTMLInputElement>('ghost').checked; drawOverlay(ctx, this.current, v, this.ov); }
  }

  /** the city takes the input: city mode without the block view on top */
  private get cityInput() { return this.cityOn && !this.blockView; }

  /** world px -> overlay px, matching the main camera (zoom about the viewport centre) */
  private view() {
    const cam = this.cameras.main, z = cam.zoom;
    return { s: z, ox: cam.scrollX + cam.width / 2 - cam.width / (2 * z), oy: cam.scrollY + cam.height / 2 - cam.height / (2 * z) };
  }

  private zoomBy(f: number) {
    if (this.cityInput) { this.city!.zoomBy(f); return; }
    const cam = this.cameras.main;
    cam.setZoom(Phaser.Math.Clamp(cam.zoom * f, 0.25, 8));
  }

  private fit() {
    if (this.cityInput) { this.city!.zoomBy(CITY_ZOOM.default / this.cameras.main.zoom); return; }   // city: default zoom
    const sc = this.current;
    if (!sc) return;
    const cam = this.cameras.main;
    const W = sc.cols * 16, H = sc.rows * 16;
    const z = Math.min(this.scale.width / W, this.scale.height / H);
    // integer zoom when possible keeps pixels crisp
    cam.setZoom(z >= 1 ? Math.floor(z) : z);
    cam.centerOn(W / 2, H / 2);
  }

  private reload() { if (this.current && !this.source && !this.blockView) this.load_(this.current.seed); }

  /** the single-block URL of a seed */
  private singleQuery(seed: string) {
    const q = new URLSearchParams({ seed });
    if (this.opts.novelty !== DEFAULT_OPTIONS.novelty) q.set('nov', String(this.opts.novelty));
    if (!this.opts.prune) q.set('p', '0');
    if (this.opts.prefs === false) q.set('l', '0');
    if (this.districtSel) q.set('d', this.districtSel);
    return q;
  }

  private load_(seed: string) {
    $<HTMLInputElement>('seed').value = seed;
    history.replaceState(null, '', `?${this.singleQuery(seed)}`);
    this.cancelGen();
    const id = this.reqId;
    this.reqT0 = performance.now(); this.busy = true;
    $('info').textContent = `生成中… seed ${seed}`;
    const sel = this.districtSel, district = sel === '' ? mixDistrict(seed) : sel === 'none' ? undefined : sel;
    this.mixed = sel === '' && !!district;
    const opts: GenOptions = { ...this.opts };
    if (district) opts.district = district;
    this.genWorker().postMessage({ id, seed, opts });
  }

  /** a newer request (or a dropped file) replaces the running one: its result is no longer wanted */
  private cancelGen() {
    if (this.busy) { this.worker?.terminate(); this.worker = undefined; this.busy = false; }
    ++this.reqId;
  }

  private genWorker(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('./viewer/gen.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<{ id: number; scene?: GenScene; error?: string }>) => {
      const d = e.data;
      if (d.id !== this.reqId) return;
      this.busy = false;
      if (d.error) { toast(`生成失败：${d.error}`); return; }
      this.show(d.scene!, performance.now() - this.reqT0, '');
    };
    const fail = (msg: string) => { this.busy = false; this.worker?.terminate(); this.worker = undefined; toast(`生成失败（Worker）：${msg}`); };
    w.onerror = (e) => fail(e.message);
    w.onmessageerror = () => fail('结果无法传回');
    return (this.worker = w);
  }

  private show(sc: GenScene, ms: number, source: string) {
    const refit = !this.current || this.current.cols !== sc.cols || this.current.rows !== sc.rows || !!source || !!this.source;
    sc.objects.forEach((o, i) => { o.id ??= `o${i}`; });   // scenes saved before v0.4.0 have no ids
    this.current = sc; this.source = source;
    this.hidden = hiddenObjects(sc);
    this.ov.hover = undefined; this.ov.pinned = undefined;
    const o = sc.options;
    const au = sc.audit;
    const dk = sc.params?.district as DistrictKind | undefined;
    const optInfo = (dk ? ` · ${DISTRICTS[dk]?.name ?? dk}${this.mixed && !source ? '（随机抽到）' : ''}` : '') + (o ? ` · 创新度 ${o.novelty.toFixed(2)}` : '')
      + (o ? ` · 偏好${o.prefs === false ? '关' : '开'}` : '')
      + (au ? ` · 约束违规 ${au.violations.length}${au.pruned.length || au.downgraded.length || au.regrounded?.length ? ` · 剪掉 ${au.pruned.length} 个物件、降级 ${au.downgraded.length} 块、改地面 ${au.regrounded?.length ?? 0} 处` : ''}` : '');
    const done = () => {
      if (this.current !== sc) return;   // replaced while the textures loaded (e.g. Esc back to the city)
      this.draw(sc, refit);
      const w = sc.params?.world as { seed: string; blockId: string } | undefined;
      const head = w ? `世界 ${w.seed} · 街区 ${w.blockId} · v${sc.version}` : `v${sc.version} · seed ${sc.seed}`;
      $('info').textContent = `${source ? `文件 ${source} · ` : ''}${head} · ${sc.cols}×${sc.rows} 格 · 内部 ${(sc.params.interior as number[]).join('×')} · ${sc.params.shape} · ${sc.objects.length} 物件${optInfo}${ms ? ` · 生成 ${ms.toFixed(0)} ms` : ''}`;
    };
    loadTextures(this, sc.sheets, sc.objects, done);
    this.buildLegend();
    this.showDetail(undefined);
    this.store = new LabelStore(sc.version, storeKey(sc));
    this.ov.labels = [];
    this.store.load().then(() => { this.ov.labels = this.store!.labels; this.renderLabelList(); this.updateForm(); this.dirty = true; });
    this.updateForm();
    this.dirty = true;
  }

  /** ground + objects into a render texture; ghost: building parts above their footprint drawn translucent */
  private render(sc: GenScene, ghost: boolean): Phaser.GameObjects.RenderTexture {
    const W = sc.cols * 16, H = sc.rows * 16;
    const rt = this.add.renderTexture(0, 0, W, H).setOrigin(0, 0);
    // one batch for the whole picture (0.7.9: a draw call per sprite took minutes on big maps in software WebGL)
    rt.beginDraw();
    drawGround(this, rt, sc.sheets, sc.ground);
    drawObjects(this, rt, sc.objects, ghost);
    rt.endDraw();
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
  // city mode

  private enterCity(u: CityUrl) {
    if (this.anno) this.toggleAnno();
    this.cancelGen();   // a single-block result arriving now would be drawn over the city
    if (!this.cityOn) { const cam = this.cameras.main; this.singleCam = { x: cam.scrollX, y: cam.scrollY, z: cam.zoom }; }
    this.cityOn = true;
    this.setCityBar(true);
    $<HTMLInputElement>('seed').value = u.seed;
    this.world?.setVisible(false); this.gridGfx?.setVisible(false);
    this.city ??= new CityMode(this, $<HTMLCanvasElement>('overlay'), (seed, id) => this.enterBlock(seed, id));
    this.city.enter(u);
  }

  /** a new world seed, same place and zoom */
  private newWorld(seed: string) {
    const cam = this.cameras.main;
    $<HTMLInputElement>('seed').value = seed;
    ++this.blockReq;
    this.city!.enter({ seed, x: Math.floor((cam.scrollX + cam.width / 2) / 16), y: Math.floor((cam.scrollY + cam.height / 2) / 16), z: cam.zoom });
  }

  /** back to the single-block view: the scene shown before (or a new one); reload = false: the caller shows a scene */
  private leaveCity(reload = true) {
    ++this.blockReq;
    if (this.blockView) { this.current = this.blockView.prev; this.source = this.blockView.prevSource; this.blockView = undefined; }
    this.city!.exit();
    this.cityOn = false;
    this.setCityBar(false);
    const c = $<HTMLCanvasElement>('overlay');
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    this.lastView = ''; this.dirty = true;
    $('info').textContent = '';
    if (!reload) return;
    const sc = this.current;
    if (!sc) { this.load_($<HTMLInputElement>('seed').value.trim() || randomSeed()); return; }   // opened in city mode: the world seed
    $<HTMLInputElement>('seed').value = sc.seed;
    if (!this.source) history.replaceState(null, '', `?${this.singleQuery(sc.seed)}`);
    this.show(sc, 0, this.source);   // redraws (the world texture comes back) and refits only for a dropped file
    const s = this.singleCam, cam = this.cameras.main;
    if (s && !this.source) { cam.setZoom(s.z); cam.setScroll(s.x, s.y); }
  }

  private setCityBar(on: boolean) {
    document.body.classList.toggle('city', on);
    document.body.classList.remove('cityblock');
    $('mode').textContent = on ? '单街区' : '城市';
    $('seedLbl').textContent = on ? '世界种子' : '种子';
    $('go').title = on ? '用输入框里的世界种子生成城市 (Enter)' : '用输入框里的种子生成 (Enter)';
    $('regen').title = on ? '随机新的世界种子 (R)' : '随机新种子并重新生成 (R)';
  }

  /** generate a city block (urgent pool job) and show it in the block view */
  private enterBlock(seed: string, id: string) {
    const req = ++this.blockReq, t0 = performance.now();
    $('info').textContent = `生成中… 街区 ${id}`;
    this.city!.blockScene(id).then(sc => {
      if (req !== this.blockReq || !this.cityInput) return;
      const cam = this.cameras.main;
      this.blockView = { seed, id, cam: { x: cam.scrollX, y: cam.scrollY, z: cam.zoom }, prev: this.current, prevSource: this.source };
      this.city!.hide();
      document.body.classList.remove('city'); document.body.classList.add('cityblock');
      this.current = undefined;   // show() refits to the block
      this.mixed = false;
      this.lastView = '';
      this.show(sc, performance.now() - t0, '');
    }, err => {
      if (req !== this.blockReq) return;
      toast(`街区 ${id} 生成失败：${err instanceof Error ? err.message : err}`);
    });
  }

  /** leave the block view: the city as it was (camera included); the scene shown before the city is current again */
  private backToCity() {
    const bv = this.blockView;
    if (!bv) return;
    if (this.anno) this.toggleAnno();   // before the camera: closing the side panel resizes the canvas
    this.blockView = undefined;
    this.current = bv.prev; this.source = bv.prevSource;
    this.world?.destroy(); this.world = undefined;
    this.gridGfx?.destroy(); this.gridGfx = undefined;
    this.ov.hover = undefined; this.ov.pinned = undefined; this.ov.box = undefined;
    document.body.classList.remove('cityblock'); document.body.classList.add('city');
    const c = $<HTMLCanvasElement>('overlay');
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    const cam = this.cameras.main;
    cam.setZoom(bv.cam.z); cam.setScroll(bv.cam.x, bv.cam.y);
    this.city!.show();
    this.city!.syncUrl();
  }

  /** city: a click (two within 350 ms enter the block) or the end of a drag */
  private cityPointerUp(moved: boolean, wx: number, wy: number) {
    const city = this.city!;
    if (moved) { city.syncUrl(); return; }
    const t = performance.now();
    if (t - this.lastClick < 350) {
      this.lastClick = 0;
      if (!city.selection) city.click(wx, wy);   // the first click of the pair unselected the block
      city.enterSelected();
      return;
    }
    this.lastClick = t;
    city.click(wx, wy);
  }

  // ------------------------------------------------------------------------------------------------
  // annotation mode

  /** the side panel opened / closed: resize the canvas now. scale.refresh() alone keeps the old size: it updates the
   *  parent size only after sizing the canvas, so Phaser's own resize check then sees no change. */
  private relayout() { this.scale.getParentBounds(); this.scale.refresh(); }

  private toggleAnno() {
    this.anno = !this.anno;
    document.body.classList.toggle('anno', this.anno);
    $('anno').classList.toggle('on', this.anno);
    this.relayout();
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

  private buildLegend() {
    const sc = this.current; if (!sc) return;
    const cnt = new Map<string, number>();
    for (const g of sc.groups ?? []) if (g.members.length && g.type !== 'bld') cnt.set(g.type, (cnt.get(g.type) ?? 0) + 1);
    $('legendGroups').innerHTML = [...cnt].sort().map(([t, n]) =>
      `<label><input type="checkbox" data-t="${esc(t)}" ${this.ov.hiddenTypes.has(t) ? '' : 'checked'}/><span class="sw" style="background:${typeColor(t)}"></span>${esc(t)}<span class="cnt">${n}</span></label>`).join('');
    $('legendGroups').querySelectorAll<HTMLInputElement>('input[data-t]').forEach(i => { i.onchange = () => { if (i.checked) this.ov.hiddenTypes.delete(i.dataset.t!); else this.ov.hiddenTypes.add(i.dataset.t!); this.dirty = true; }; });
    const nNovel = sc.objects.filter(o => o.novel).length;
    if (nNovel) {
      $('legendGroups').insertAdjacentHTML('beforeend', `<label title="参考图里没用过的贴图"><input type="checkbox" id="legendNovel" ${this.ov.hideNovel ? '' : 'checked'}/><span class="sw" style="background:${NOVEL_COLOR}"></span>新贴图<span class="cnt">${nNovel}</span></label>`);
      $<HTMLInputElement>('legendNovel').onchange = () => { this.ov.hideNovel = !$<HTMLInputElement>('legendNovel').checked; this.dirty = true; };
    }
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
      if (o.novel) h += row('新贴图', `<span style="color:${NOVEL_COLOR}">新贴图（参考图里没用过）</span>`);
      const prefDecs = o.stream ? (sc.trace?.decisions as Decision[] | undefined)?.filter(d => d.s === o.stream && d.m) ?? [] : [];
      for (const d of prefDecs.slice(0, 8)) {
        // the multipliers that exist (the picked option may have none); n counts label-derived comparisons too
        const n = PREFS.labels[d.label]?.n ?? 0, fmt = (v: number) => v.toFixed(2).replace(/\.?0+$/, '');
        const ms = Object.entries(d.m!).map(([o, v]) => `${o === d.pick ? `<b>${esc(o)}</b>` : esc(o)} ×${fmt(v)}`).join('、');
        h += row('偏好', `<span class="mini">${esc(d.label)}：选中 ${esc(d.pick)} · 偏好：${ms}（${n} 次比较）</span>`);
      }
      if (prefDecs.length > 8) h += row('偏好', `<span class="mini">…还有 ${prefDecs.length - 8} 个</span>`);
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
    const w = sc.params?.world as { seed: string; blockId: string } | undefined;
    if (w) l.world = { seed: w.seed, blockId: w.blockId };
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
    files.push([new Blob([JSON.stringify(sc)], { type: 'application/json' }), `${base}.json`]);
    const labels = this.store?.labels ?? [];
    if (labels.length) files.push([new Blob([JSON.stringify({ version: sc.version, seed: sc.seed, labels }, null, 1)], { type: 'application/json' }), `${base}_labels.json`]);
    (window as unknown as { __exportCount: number }).__exportCount = files.length;
    (async () => { for (const [b, name] of files) download(typeof b === 'function' ? await b() : b, name); })();
  }
}

new Phaser.Game({
  type: Phaser.WEBGL,
  parent: 'game',
  pixelArt: true,
  roundPixels: true,
  scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
  scene: [CityView],
});
