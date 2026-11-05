// Stage 7: the Trace.adjust hook = learned preference multipliers (prefs.ts) times the novelty factor (novelty.ts).
// A decision none of the factors applies to, or whose multipliers are all exactly 1, returns null (original code
// path: the picture does not change).
import type { Adjust } from '../rng';
import type { GenOptions } from '../types';
import { multiplier, type PrefTable } from './prefs';
import { noveltyFactors } from './novelty';

export function makeAdjust(opts: GenOptions, prefs?: PrefTable): Adjust | undefined {
  const table = opts.prefs !== false && prefs && Object.keys(prefs.labels).length ? prefs : null;
  const nov = opts.novelty;
  if (!table && !nov) return undefined;
  const ones = (w: number[]) => { for (const x of w) if (x !== 1) return false; return true; };
  // a call site mostly repeats its option list: reuse the novelty factors of the label's last list when it is equal
  const last = new Map<string, { os: string[]; nf: ReturnType<typeof noveltyFactors> }>();
  const factors = (label: string, os: string[]) => {
    const l = last.get(label);
    if (l && l.os.length === os.length && l.os.every((o, j) => o === os[j])) return l.nf;
    const nf = noveltyFactors(nov, os);
    last.set(label, { os, nf });
    return nf;
  };
  return (label, ctx, os) => {
    // preference factor first (null: label not in the table), then novelty (null: no sprite option)
    const pw = table?.labels[label] ? os.map(o => multiplier(table, label, ctx, o)) : null;
    const nf = nov ? factors(label, os) : null;
    // novelty only (the usual case, ~200k decisions per map): no copies, no m
    if (!pw) return !nf || ones(nf.w) ? null : { w: nf.w, ...(nf.novel.length ? { novel: nf.novel } : {}) };
    const w = nf ? pw.map((x, j) => x * nf.w[j]) : pw;
    if (ones(w)) return null;
    // m: the preference multipliers that differ from 1 (novelty factors follow from usage.json, not recorded);
    // w0 (prefs only): lets rng.ts tell whether the novelty changed the pick (only then is it novel)
    const m: Record<string, number> = {};
    os.forEach((o, j) => { if (pw[j] !== 1) m[o] = pw[j]; });
    return { w, w0: pw, ...(Object.keys(m).length ? { m } : {}), ...(nf?.novel.length ? { novel: nf.novel } : {}) };
  };
}
