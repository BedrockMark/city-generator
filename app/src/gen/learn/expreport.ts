// Stage 7 (spec 6): evidence for promoting / retiring an experiment from the user's labels and A/B answers.
// Pure; scripts/experiments.ts feeds it. Nothing here changes exp.ts: promotion / retirement is done by hand after asking.
import { objBox } from '../judge/align';
import type { PxRect, Scene } from '../types';
import type { Comparison } from './prefs';

export interface ExpEvidence { id: string; good: number; bad: number; abWin: number; abLose: number; total: number; goodShare: number | null; suggestion: '建议转正' | '建议废弃' | '继续观察' }

export const MIN_EVIDENCE = 8, PROMOTE_SHARE = 0.7, RETIRE_SHARE = 0.3;

const hit = (a: PxRect, r: PxRect) => a.x0 < r.x1 && r.x0 < a.x1 && a.y0 < r.y1 && r.y0 < a.y1;

/** does the region hold something of experiment `id`: an object whose box centre is inside, or a zone that intersects */
export function regionHasExp(sc: Scene, r: PxRect, id: string): boolean {
  const inside = sc.objects.some(o => {
    if (o.exp !== id) return false;
    const b = objBox(o), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    return cx >= r.x0 && cx < r.x1 && cy >= r.y0 && cy < r.y1;
  });
  return inside || (sc.zones ?? []).some(z => z.exp === id && hit(z.rect, r));
}

export function expEvidence(id: string, labels: { verdict: 'good' | 'bad'; rect: PxRect; scene: Scene }[], cs: Comparison[]): ExpEvidence {
  let good = 0, bad = 0, abWin = 0, abLose = 0;
  for (const l of labels) if (regionHasExp(l.scene, l.rect, id)) { if (l.verdict === 'good') good++; else bad++; }
  for (const c of cs) {
    if (c.label !== 'exp.fire' || c.stream !== `exp/${id}` || c.answer === 'same') continue;
    const winner = c.answer === 'a' ? c.a : c.b;
    if (winner === 'true') abWin++; else abLose++;
  }
  const total = good + bad + abWin + abLose;
  const goodShare = total ? (good + abWin) / total : null;
  const suggestion = total >= MIN_EVIDENCE && goodShare !== null
    ? goodShare >= PROMOTE_SHARE ? '建议转正' : goodShare <= RETIRE_SHARE ? '建议废弃' : '继续观察' : '继续观察';
  return { id, good, bad, abWin, abLose, total, goodShare, suggestion };
}
