// Stage 6 heat map (key H): the judge's oddness score per window, drawn with Canvas 2D so the same code paints the
// screen and the exported _heat.png. Each pixel takes the highest score of the windows covering it, from transparent
// to red; windows above the threshold get an outline.
import type { Scene, PxRect } from '../gen/types';
import type { JudgeWin } from '../gen/judge/model';
import { MODEL } from '../gen/judge/model';
import { FEATURES } from '../gen/judge/features';
import type { View } from './overlay';

const inR = (r: PxRect, x: number, y: number) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;

/** the window with the highest score under a world point */
export function heatAt(sc: Scene, x: number, y: number): JudgeWin | undefined {
  return (sc.judge?.windows ?? []).filter(w => inR(w.rect, x, y)).sort((a, b) => b.score - a.score)[0];
}

/** one line per reason: feature name, whether its value is high or low here, its push towards "odd" */
export function reasons(w: JudgeWin): string[] {
  return w.top.map(t => {
    const f = FEATURES.find(f => f.id === t.f);
    const wt = MODEL.w[MODEL.features.indexOf(t.f)] ?? 0;
    const high = wt === 0 ? t.contrib >= 0 : Math.sign(t.contrib) === Math.sign(wt);
    return `${f?.name ?? t.f}${high ? '偏高' : '偏低'}（${t.contrib >= 0 ? '+' : ''}${t.contrib.toFixed(2)}）`;
  });
}

export function drawHeat(ctx: CanvasRenderingContext2D, sc: Scene, v: View) {
  const j = sc.judge;
  if (!j) return;
  const X = (x: number) => (x - v.ox) * v.s, Y = (y: number) => (y - v.oy) * v.s;
  ctx.save();
  // cell-level max over the windows (windows are cell aligned), then one rect per cell
  const T = 16, cols = sc.cols, rows = sc.rows;
  const best = new Float32Array(cols * rows);
  for (const w of j.windows) for (let r = w.rect.y0 / T; r < w.rect.y1 / T; r++) for (let c = w.rect.x0 / T; c < w.rect.x1 / T; c++)
    if (r >= 0 && c >= 0 && r < rows && c < cols) best[r * cols + c] = Math.max(best[r * cols + c], w.score);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const s = best[r * cols + c]; if (!s) continue;
    ctx.fillStyle = `rgba(230, 30, 30, ${(0.6 * s).toFixed(3)})`;
    ctx.fillRect(X(c * T), Y(r * T), T * v.s + 0.5, T * v.s + 0.5);
  }
  ctx.lineWidth = 2; ctx.strokeStyle = '#ffeb3b';
  for (const w of j.windows) if (w.score > j.threshold) ctx.strokeRect(X(w.rect.x0) + 1, Y(w.rect.y0) + 1, (w.rect.x1 - w.rect.x0) * v.s - 2, (w.rect.y1 - w.rect.y0) * v.s - 2);
  ctx.restore();
}
