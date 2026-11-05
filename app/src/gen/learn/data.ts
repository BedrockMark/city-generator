// Stage 7 training data (spec 4.2): the user's A/B choices and good / bad labels as Bradley–Terry comparisons. Node only.
// - choice files references/choices/v<version>/seed<seed>_<time>.json (spec 3.4): one comparison per answered change,
//   weight 1, batch = the file; no regeneration needed;
// - labels (v0.5.1 on): from 0.7.0 the saved scene (objects carry `stream`); before, the scene is regenerated with the
//   current generator (novelty 0, no preferences; novelty had no effect then) and used when its picture equals the saved
//   one, else the saved scene when its objects carry `stream` (v0.6.0 on), else skipped. Attribution: the streams that
//   placed the labelled objects (key + position ±2px) or the objects whose foot lies in the labelled region; their
//   judgeable decisions (rng.ts judgeable: ≥ 2 alternatives, no JSON-shown geometry option such as pack.run "[11,40]";
//   choice comparisons with such an option are skipped too). Bad: each pick loses against each alternative; good: wins;
//   0.3 per label, split evenly.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from '../generate';
import { signature } from '../signature';
import { alternatives, judgeable, isGeometryOption, type Decision } from '../rng';
import { objBox } from '../judge/align';
import { LABEL_DIR, labelRegion, verGE } from '../judge/labelset';
import type { Label } from '../../viewer/labels';
import type { GenOptions, Placed, PxRect, Scene } from '../types';
import type { Comparison } from './prefs';

const here = dirname(fileURLToPath(import.meta.url));
export const CHOICE_DIR = join(here, '..', '..', '..', '..', 'references', 'choices');
export const LABEL_W = 0.3;
/** skip reasons of labels with nothing to attribute */
export const NO_DECISIONS = ['被标注的物件在场景里找不到', '归因到的流里没有可换的决策', '没有归因到任何随机流'];

/** a choice file (spec 3.4) */
export interface ChoiceFile { version: string; seed: string; options: Partial<GenOptions>; novelty: number; created: string; kind: 'auto' | 'manual';
  changes: { stream: string; label: string; k: number; ctx?: Record<string, string | number | boolean>; a: string; b: string; rect: PxRect; answer?: 'a' | 'b' | 'same'; note?: string }[] }

/** every *.json below dir (relative paths with '/') */
const walk = (dir: string, root = dir): string[] => readdirSync(dir).sort().flatMap(f => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p, root) : f.endsWith('.json') ? [relative(root, p).split('\\').join('/')] : [];
});

export function readChoiceFiles(dir = CHOICE_DIR): { file: string; data: ChoiceFile }[] {
  return existsSync(dir) ? walk(dir).map(file => ({ file, data: JSON.parse(readFileSync(join(dir, file), 'utf8')) as ChoiceFile })) : [];
}

/** answered changes of every choice file; skipped = changes without an answer or with a JSON-shown (geometry) option */
export function loadChoiceComparisons(dir = CHOICE_DIR): { cs: Comparison[]; files: number; skipped: number } {
  const fs = readChoiceFiles(dir), cs: Comparison[] = [];
  let skipped = 0;
  for (const { file, data } of fs) for (const c of data.changes ?? []) {
    if (!c.answer || isGeometryOption(c.a) || isGeometryOption(c.b)) { skipped++; continue; }
    cs.push({ label: c.label, ctx: c.ctx ?? {}, a: c.a, b: c.b, answer: c.answer, w: 1, batch: file, stream: c.stream, src: { seed: String(data.seed), rect: c.rect, file } });
  }
  return { cs, files: fs.length, skipped };
}

export interface LabelAttribution { label: Label; file: string; scene: Scene; decisions: Decision[]; region: PxRect; regenerated: boolean }

const near = (o: Placed, s: { key: string; x: number; y: number }) => o.key === s.key && Math.abs(o.x - s.x) <= 2 && Math.abs(o.y - s.y) <= 2;
const footIn = (o: Placed, r: PxRect) => { const b = objBox(o), fx = (b.x0 + b.x1) / 2, fy = b.y1; return fx >= r.x0 && fx < r.x1 && fy >= r.y0 && fy < r.y1; };

/** a label attributeLabels could not use: why, plus the label, its saved scene and region (gaps lists bad ones) */
export interface SkippedLabel { file: string; id: string; why: string; label: Label; scene: Scene; region: PxRect }

/** labels from minVersion on with the scene they refer to and the decisions they are attributed to */
export function attributeLabels(minVersion = '0.5.1'): { items: LabelAttribution[]; skipped: SkippedLabel[] } {
  const items: LabelAttribution[] = [], skipped: SkippedLabel[] = [];
  if (!existsSync(LABEL_DIR)) return { items, skipped };
  const gens = new Map<string, Scene>();
  for (const v of readdirSync(LABEL_DIR).filter(d => /^v\d/.test(d) && verGE(d, minVersion)).sort()) {
    const d = join(LABEL_DIR, v);
    for (const f of readdirSync(d).filter(f => /^seed.*\.json$/.test(f) && !f.endsWith('.scene.json')).sort()) {
      const file = `${v}/${f}`, saved = new Map<string, Scene>();
      for (const l of (JSON.parse(readFileSync(join(d, f), 'utf8')).labels ?? []) as Label[]) {
        if (!saved.has(l.scene)) saved.set(l.scene, JSON.parse(readFileSync(join(d, l.scene), 'utf8')) as Scene);
        const old = saved.get(l.scene)!, region = labelRegion(l, old), hasStream = old.objects.some(p => p.stream);
        const skip = (why: string) => skipped.push({ file, id: l.id, why, label: l, scene: old, region });
        // from 0.7.0 the saved scene (with streams) is used as is; older ones are regenerated (novelty had no effect)
        let sc: Scene | null = null, same = false;
        if (verGE(l.version, '0.7.0')) sc = hasStream ? old : null;
        else {
          const o: Partial<GenOptions> = { ...l.options, novelty: 0, prefs: false, force: undefined }, key = JSON.stringify([l.seed, o]);
          if (!gens.has(key)) gens.set(key, generate(l.seed, o));
          const now = gens.get(key)!;
          same = JSON.stringify(signature(now)) === JSON.stringify(signature(old));
          sc = same ? now : hasStream ? old : null;
        }
        if (!sc) { skip(verGE(l.version, '0.7.0') ? '存下的场景物件没有 stream' : '签名不同（重新生成的画面和存下的不一样），存下的场景物件没有 stream'); continue; }
        const t = l.target;
        const objs = t.objects.length && t.kind !== 'region' ? sc.objects.filter(p => t.objects.some(s => near(p, s))) : sc.objects.filter(p => footIn(p, region));
        if (t.objects.length && t.kind !== 'region' && !objs.length) { skip(NO_DECISIONS[0]); continue; }
        const streams = new Set(objs.map(p => p.stream).filter((s): s is string => !!s));
        const decisions = ((sc.trace?.decisions ?? []) as Decision[]).filter(x => streams.has(x.s) && judgeable(x));
        if (!decisions.length) { skip(NO_DECISIONS[streams.size ? 1 : 2]); continue; }
        items.push({ label: l, file, scene: sc, decisions, region, regenerated: same });
      }
    }
  }
  return { items, skipped };
}

/** bad label: each pick loses against each alternative (a = pick, b = alternative, answer b); good: answer a.
 *  LABEL_W per label, split evenly over its comparisons */
export function labelComparisons(items: LabelAttribution[]): Comparison[] {
  const out: Comparison[] = [];
  for (const it of items) {
    const pairs = it.decisions.filter(judgeable).flatMap(d => alternatives(d).filter(b => b !== d.pick).map(b => [d, b] as const));
    const w = LABEL_W / Math.max(1, pairs.length), batch = `label:${it.file}#${it.label.id}`;
    for (const [d, b] of pairs) out.push({ label: d.label, ctx: d.ctx ?? {}, a: d.pick, b, answer: it.label.verdict === 'bad' ? 'b' : 'a', w, batch,
      stream: d.s, src: { seed: it.label.seed, rect: it.region, file: it.file } });
  }
  return out;
}
