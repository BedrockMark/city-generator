// Stage 6 judge: the user's good / bad labels as window labels (spec 2.4, 2026-11-03 addendum). Node only.
// - only labels from v0.5.1 on (the user: older ones are mostly obsolete or duplicated);
// - the region is read from the scene saved when the label was made, never regenerated (the generator changed);
// - a click on a single cell (no object) means the area it lies in: the smallest yard / block zone under it;
// - a window carries the label when it holds at least half of what any window could hold of the region:
//   overlap / (min(region w, window w) * min(region h, window h)) >= 0.5 (= min(region, window) area for compact
//   regions; a long thin strip still labels the windows it runs through).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Label } from '../../viewer/labels';
import type { PxRect, Scene } from '../types';
import type { Win } from './features';

const here = dirname(fileURLToPath(import.meta.url));
export const LABEL_DIR = join(here, '..', '..', '..', '..', 'references', 'labels');

export interface LabelRegion { file: string; id: string; seed: string; verdict: 'good' | 'bad'; rect: PxRect; scene: Scene }

const ver = (v: string) => v.replace(/^v/, '').split('.').map(Number);
const verGE = (a: string, b: string) => { const x = ver(a), y = ver(b); for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0); return true; };
const area = (r: PxRect) => Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);

export function labelRegion(l: Label, sc: Scene): PxRect {
  const t = l.target, r = t.rect;
  const click = !t.objects.length && r.x1 - r.x0 <= 16 && r.y1 - r.y0 <= 16;
  if (!click) return { ...r };
  const zs = (sc.zones ?? []).filter(z => t.zones.includes(z.id) && (z.layer === 'yard' || z.layer === 'block')).sort((a, b) => area(a.rect) - area(b.rect));
  return { ...(zs[0]?.rect ?? r) };
}

export function loadLabelRegions(minVersion = '0.5.1'): LabelRegion[] {
  if (!existsSync(LABEL_DIR)) return [];
  const out: LabelRegion[] = [];
  for (const v of readdirSync(LABEL_DIR).filter(d => /^v\d/.test(d) && verGE(d, minVersion)).sort()) {
    const d = join(LABEL_DIR, v);
    for (const f of readdirSync(d).filter(f => /^seed.*\.json$/.test(f) && !f.endsWith('.scene.json')).sort()) {
      const labels = (JSON.parse(readFileSync(join(d, f), 'utf8')).labels ?? []) as Label[];
      const scenes = new Map<string, Scene>();
      for (const l of labels) {
        if (!scenes.has(l.scene)) scenes.set(l.scene, JSON.parse(readFileSync(join(d, l.scene), 'utf8')) as Scene);
        const sc = scenes.get(l.scene)!;
        out.push({ file: join(v, f), id: l.id, seed: l.seed, verdict: l.verdict, rect: labelRegion(l, sc), scene: sc });
      }
    }
  }
  return out;
}

/** indices of the windows that carry a label on `region` */
export function coveredWindows(region: PxRect, wins: Win[]): number[] {
  const out: number[] = [];
  wins.forEach((w, i) => {
    const ov = area({ x0: Math.max(w.rect.x0, region.x0), y0: Math.max(w.rect.y0, region.y0), x1: Math.min(w.rect.x1, region.x1), y1: Math.min(w.rect.y1, region.y1) });
    const most = Math.min(region.x1 - region.x0, w.rect.x1 - w.rect.x0) * Math.min(region.y1 - region.y0, w.rect.y1 - w.rect.y0);
    if (ov / Math.max(1, most) >= 0.5) out.push(i);
  });
  return out;
}
