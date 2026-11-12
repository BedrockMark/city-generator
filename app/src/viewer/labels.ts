// Good / bad labels on generated scenes. Saved through the vite dev server (vite.config.ts, /api/labels) to
//   references/labels/v<version>/seed<key>.json          { version, seed, labels: Label[] }   key = storeKey(scene)
//   references/labels/v<version>/<scene file>.scene.json  the labelled scene (with explanations and trace)
// so later stages (constraint tests, critic training, learning) can read them without regenerating.
// Without the dev server the labels fall back to localStorage (and still go out with every export).
import type { GenOptions, PxRect, Scene } from '../gen/types';
import { DEFAULT_OPTIONS } from '../gen/exp';
import { hash01 } from '../world/hash';

export const GOOD_TAGS = ['关系合理 / 有叙事', '热闹不空', '自然有机', '有特色', '留白恰当', '布局合理'];
export const BAD_TAGS = ['没有存在理由', '不通向任何地方', '挡路', '位置不合理', '朝向错误', '重叠 / 穿插', '太空', '太挤', '重复 / 复制感', '方正呆板', '比例不对', '遮挡 / 露出错误'];

export interface LabelTarget {
  kind: 'object' | 'building' | 'region';
  /** px rect in scene coordinates */
  rect: PxRect;
  /** objects concerned (snapshot of id, sprite and position so the label survives id changes in later versions) */
  objects: { id: string; key: string; cls: string; gid?: string; x: number; y: number }[];
  gids: string[];
  /** zones under the target (why-empty areas) */
  zones: string[];
}

export interface Label {
  id: string;
  created: string;
  version: string;
  seed: string;
  novelty: number;
  options: GenOptions;
  /** scene file the label refers to (saved next to the labels) */
  scene: string;
  verdict: 'good' | 'bad';
  tags: string[];
  text: string;
  target: LabelTarget;
  /** city block (v0.8.1): the world seed and block id it was generated from (labeltests replays it with getBlock) */
  world?: { seed: string; blockId: string };
}

/** file stem of a scene: seed plus the options that differ from the defaults */
export function sceneStem(sc: Scene): string {
  return `seed${sc.seed}${optionSuffix(sc)}`.replace(/[^\w.-]/g, '_');
}

/** the options that differ from the defaults, as a file name suffix */
function optionSuffix(sc: Scene): string {
  const o = sc.options;
  let s = '';
  if (o) {
    if (o.novelty !== DEFAULT_OPTIONS.novelty) s += `_n${o.novelty.toFixed(2)}`;
    if (o.prune === false) s += '_p0';
    if (o.pruneDraft) s += '_pd1';
    if (o.prefs === false) s += '_l0';
    if (o.district) s += `_d${o.district}`;   // 0.7.8.2: seed 1 and seed 1 as a school are different scenes
  }
  return s;
}

/** s when it has at most max chars, else its first max - 9 chars + '_' + 8 hex digits of a hash of `full` */
function capName(s: string, max: number, full: string): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 9)}_${Math.floor(hash01('label-key', full) * 2 ** 32).toString(16).padStart(8, '0')}`;
}

/** the label file key of a scene: its seed for a single block; `w<world seed>_<block id>` for a city block, made
 *  file-safe (the dev server takes [\w.-]{1,80}); keys too long keep 71 chars + '_' + a hash of the whole key */
export function storeKey(sc: Scene): string {
  const w = sc.params?.world as { seed: string; blockId: string } | undefined;
  if (!w) return sc.seed;
  const full = `w${w.seed}_${w.blockId}`;
  return capName(full.replace(/[^\w.-]/g, '_'), 80, full);
}

/** the file a label's scene is saved to: `<sceneStem>.scene.json` for a single block; for a city block named from
 *  storeKey (seedw…, cannot meet a single-block name) plus the option suffix, capped so the whole name fits the dev
 *  server's 80 chars */
export function labelSceneName(sc: Scene): string {
  if (!sc.params?.world) return `${sceneStem(sc)}.scene.json`;
  const stem = `seed${storeKey(sc)}${optionSuffix(sc)}`.replace(/[^\w.-]/g, '_');
  return `${capName(stem, 80 - '.scene.json'.length, stem)}.scene.json`;
}

const LS = (version: string, seed: string) => `citygen-labels/${version}/${seed}`;

export class LabelStore {
  labels: Label[] = [];
  /** 'server' when the dev server answered, else 'local' */
  mode: 'server' | 'local' = 'local';
  private savedScenes = new Set<string>();
  constructor(readonly version: string, readonly seed: string) {}

  async load() {
    try {
      const r = await fetch(`/api/labels?version=${encodeURIComponent(this.version)}&seed=${encodeURIComponent(this.seed)}`);
      if (!r.ok) throw new Error(String(r.status));
      this.labels = (await r.json()).labels ?? [];
      this.mode = 'server';
    } catch {
      this.labels = JSON.parse(localStorage.getItem(LS(this.version, this.seed)) ?? '[]');
      this.mode = 'local';
    }
  }

  nextId() { return `L${Math.max(0, ...this.labels.map(l => +l.id.slice(1) || 0)) + 1}`; }

  async add(l: Label, scene: Scene) { this.labels.push(l); await this.persist(scene); }
  async remove(id: string, scene: Scene) { this.labels = this.labels.filter(l => l.id !== id); await this.persist(scene); }

  private async persist(scene: Scene) {
    localStorage.setItem(LS(this.version, this.seed), JSON.stringify(this.labels));
    const name = labelSceneName(scene);
    const body: Record<string, unknown> = { version: this.version, seed: this.seed, labels: this.labels };
    if (!this.savedScenes.has(name) && this.labels.some(l => l.scene === name)) body.scene = { name, data: scene };
    try {
      const r = await fetch('/api/labels', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(await r.text());
      this.mode = 'server';
      if (body.scene) this.savedScenes.add(name);
    } catch (e) {
      this.mode = 'local';
      console.warn('labels: dev server unavailable, kept in localStorage', e);
    }
  }
}
