// Coordinate hash: a pure function of (seed, keys), so any world cell can be computed locally in any order.
// Same cyrb128 mixing as gen/rng.ts, reduced to the first 32-bit word.

function cyrb32(str: string): number {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return (h1 ^ h2 ^ h3 ^ h4) >>> 0;
}

/** Deterministic value in [0, 1) for (seed, keys). */
export function hash01(seed: string, ...k: (string | number)[]): number {
  return cyrb32(`${seed}|${k.join(',')}`) / 4294967296;
}

/** Deterministic integer in [lo, hi] (both inclusive). */
export function hashInt(seed: string, lo: number, hi: number, ...k: (string | number)[]): number {
  return lo + Math.floor(hash01(seed, ...k) * (hi - lo + 1));
}

/** Deterministic weighted pick. */
export function hashPick<T>(seed: string, weights: readonly (readonly [T, number])[], ...k: (string | number)[]): T {
  let total = 0;
  for (const [, w] of weights) total += w;
  let r = hash01(seed, ...k) * total;
  for (const [v, w] of weights) { if (r < w) return v; r -= w; }
  return weights[weights.length - 1][0];
}
