// The user's good / bad labels on disk (references/labels/v<version>/), read by the preference training. Node only.
// A click on a single cell (no object) means the area it lies in: the smallest yard / block zone under it.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Label } from '../../viewer/labels';
import type { PxRect, Scene } from '../types';

const here = dirname(fileURLToPath(import.meta.url));
export const LABEL_DIR = join(here, '..', '..', '..', '..', 'references', 'labels');

const ver = (v: string) => v.replace(/^v/, '').split('.').map(Number);
export const verGE = (a: string, b: string) => { const x = ver(a), y = ver(b); for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0); return true; };
const area = (r: PxRect) => Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);

export function labelRegion(l: Label, sc: Scene): PxRect {
  const t = l.target, r = t.rect;
  const click = !t.objects.length && r.x1 - r.x0 <= 16 && r.y1 - r.y0 <= 16;
  if (!click) return { ...r };
  const zs = (sc.zones ?? []).filter(z => t.zones.includes(z.id) && (z.layer === 'yard' || z.layer === 'block')).sort((a, b) => area(a.rect) - area(b.rect));
  return { ...(zs[0]?.rect ?? r) };
}
