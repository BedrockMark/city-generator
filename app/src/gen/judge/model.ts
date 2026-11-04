// Stage 6 judge: standardised L1-regularised logistic regression (coordinate descent, plain TS) and scoring.
// Label 1 = looks generated (odd), 0 = looks like a reference. The "oddness" of a window is the model probability.
import { FEATURES, windows, featureMatrix } from './features';
import type { JWorld } from './align';
import type { PxRect } from '../types';
import judgeRaw from '../data/judge.json';

export interface JudgeModel {
  features: string[]; mean: number[]; std: number[]; w: number[]; b: number; lambda: number;
  /** window threshold = 90th percentile of the reference windows' scores */
  threshold: number;
  /** 90th percentile of the references' whole-map mean scores (global repair tier) */
  refMeanP90: number;
  trained: string; data: Record<string, unknown>;
}
export interface JudgeWin { rect: PxRect; score: number; top: { f: string; contrib: number }[] }
export interface JudgeResult { model: string; threshold: number; windows: JudgeWin[]; mean: number; max: number }

export const MODEL = judgeRaw as JudgeModel;

const sigmoid = (t: number) => 1 / (1 + Math.exp(-t));

export function standardize(X: number[][]): { mean: number[]; std: number[] } {
  const n = X.length, k = X[0]?.length ?? 0;
  const mean = Array.from({ length: k }, (_, j) => X.reduce((s, r) => s + r[j], 0) / Math.max(1, n));
  const std = mean.map((m, j) => { const v = Math.sqrt(X.reduce((s, r) => s + (r[j] - m) ** 2, 0) / Math.max(1, n)); return v > 1e-12 ? v : 1; });
  return { mean, std };
}

/** weighted logistic loss / sum(sw) + lambda * |w|_1 (intercept not penalised); X standardised.
 *  Coordinate descent on the quadratic upper bound (curvature <= 1/4), so every step decreases the objective. */
export function fitL1(X: number[][], y: number[], sw: number[], lambda: number, w0?: number[], b0?: number): { w: number[]; b: number } {
  const n = X.length, k = X[0]?.length ?? 0;
  const S = sw.reduce((a, b) => a + b, 0);
  const w = w0 ? [...w0] : new Array(k).fill(0);
  let b = b0 ?? 0;
  const eta = X.map((r, i) => b + r.reduce((s, v, j) => s + v * w[j], 0));
  const L = Array.from({ length: k }, (_, j) => 0.25 * X.reduce((s, r, i) => s + sw[i] * r[j] * r[j], 0) / S);
  for (let sweep = 0; sweep < 2000; sweep++) {
    let maxd = 0;
    // intercept
    { let g = 0; for (let i = 0; i < n; i++) g += sw[i] * (sigmoid(eta[i]) - y[i]); g /= S;
      const d = -g / 0.25; b += d; for (let i = 0; i < n; i++) eta[i] += d; maxd = Math.max(maxd, Math.abs(d)); }
    for (let j = 0; j < k; j++) {
      if (L[j] <= 0) continue;
      let g = 0; for (let i = 0; i < n; i++) g += sw[i] * (sigmoid(eta[i]) - y[i]) * X[i][j]; g /= S;
      const u = w[j] - g / L[j], t = lambda / L[j];
      const nw = u > t ? u - t : u < -t ? u + t : 0;
      const d = nw - w[j];
      if (d !== 0) { w[j] = nw; for (let i = 0; i < n; i++) eta[i] += d * X[i][j]; }
      maxd = Math.max(maxd, Math.abs(d));
    }
    if (maxd < 1e-5) break;
  }
  return { w, b };
}

/** area under the ROC curve (ties count half) */
export function auc(score: number[], y: number[]): number {
  const idx = score.map((s, i) => i).sort((a, b) => score[a] - score[b]);
  let rankSum = 0, pos = 0;
  for (let i = 0; i < idx.length;) {
    let j = i; while (j < idx.length && score[idx[j]] === score[idx[i]]) j++;
    const r = (i + j + 1) / 2;   // mean 1-based rank of the tie block
    for (let t = i; t < j; t++) if (y[idx[t]] === 1) { rankSum += r; pos++; }
    i = j;
  }
  const neg = idx.length - pos;
  return pos && neg ? (rankSum - pos * (pos + 1) / 2) / (pos * neg) : 0.5;
}

export function scoreMatrix(m: JudgeModel, X: number[][]): { p: number[]; contrib: number[][] } {
  const contrib = X.map(r => r.map((v, j) => m.w[j] * (v - m.mean[j]) / m.std[j]));
  return { p: contrib.map(c => sigmoid(c.reduce((s, v) => s + v, m.b))), contrib };
}

/** every window of the map scored, with the 3 features pushing it most towards "generated" */
export function scoreWorld(w: JWorld, m: JudgeModel = MODEL): JudgeResult {
  const feats = m.features.map(id => FEATURES.find(f => f.id === id)!);
  const wins = windows(w);
  const { p, contrib } = scoreMatrix(m, featureMatrix(w, wins, feats));
  const out: JudgeWin[] = wins.map((win, i) => ({
    rect: win.rect, score: p[i],
    top: contrib[i].map((c, j) => ({ f: m.features[j], contrib: c })).sort((a, b) => b.contrib - a.contrib).slice(0, 3),
  }));
  return { model: m.trained, threshold: m.threshold, windows: out, mean: out.length ? p.reduce((a, b) => a + b, 0) / p.length : 0, max: out.length ? Math.max(...p) : 0 };
}
