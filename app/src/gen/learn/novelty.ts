// Stage 7 novelty (spec section 5): prefer sprites the references rarely use. Counts come from data/usage.json
// (tools/export_usage.py: reference detections + holdout scenes; never counted at generation time).
// Rarity r = 1 - log(1 + n) / log(1 + max) in 0..1; weight factor 1 + novelty * BETA * r. An option applies when its
// string form is a sprite key or a modular building family. A pick with n = 0 makes its objects `novel` only when the
// novelty changed it (rng.ts compares with the prefs-only weights w0 on the same random number).
import { hasSprite, MODULAR } from '../assets';
import type { Scene } from '../types';
import usageRaw from '../data/usage.json';

export interface Usage { counts: Record<string, number>; max: number; sources: Record<string, number> }
export const USAGE = usageRaw as Usage;
export const BETA = 3;

const LOGMAX = Math.log(1 + USAGE.max);
// cached per key (strings from the data tables keep their hash, so the lookup is cheap); ~200k decisions per map
const RARITY = new Map<string, number | undefined>();

/** rarity of a sprite key / modular family; undefined = not a sprite option (novelty does not apply) */
export function rarity(key: string): number | undefined {
  let r = RARITY.get(key);
  if (r === undefined && !RARITY.has(key)) {
    r = !hasSprite(key) && !(key in MODULAR) ? undefined : LOGMAX > 0 ? 1 - Math.log(1 + (USAGE.counts[key] ?? 0)) / LOGMAX : 1;
    RARITY.set(key, r);
  }
  return r;
}

/** weight factors for a decision's options (string form); null = no option applies. novel: applicable options never used */
export function noveltyFactors(novelty: number, opts: string[]): { w: number[]; novel: string[] } | null {
  let w: number[] | null = null, novel: string[] = [];
  for (let j = 0; j < opts.length; j++) {
    const r = rarity(opts[j]);
    if (r === undefined) continue;
    if (!w) w = new Array<number>(opts.length).fill(1);
    w[j] = 1 + novelty * BETA * r;
    if (r === 1 && !(USAGE.counts[opts[j]] ?? 0)) novel.push(opts[j]);
  }
  return w ? { w, novel } : null;
}

/** marks objects drawn from a novel pick (Trace.novel, "<stream>|<option>"): each entry marks at most one object, the
 *  first unmarked one (scene order) on that stream whose key is the pick or a piece of the picked modular family */
export function markNovel(sc: Scene, picks: string[]) {
  for (const p of picks) {
    const i = p.lastIndexOf('|'), s = p.slice(0, i), k = p.slice(i + 1);
    const fam = k in MODULAR ? new Set(MODULAR[k].map(q => q.key)) : null;
    const o = sc.objects.find(o => !o.novel && (o.stream ?? '') === s && (o.key === k || fam?.has(o.key)));
    if (o) o.novel = true;
  }
}
