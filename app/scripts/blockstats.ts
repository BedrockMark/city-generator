// World-layer block statistics. Usage: npx tsx scripts/blockstats.ts <cmd> [--seeds a,b,...]
//   zone: zoneValue at arterial-cell centres (seeds 1..30, cells -3..3 each way) and the three-way split
import { cellRect } from '../src/world/arterials';
import { zoneValue } from '../src/world/zone';
import { ZONE_THRESHOLDS } from '../src/world/config';

const args = process.argv.slice(2);
const cmd = args[0];
const si = args.indexOf('--seeds');
const seeds = si >= 0 ? args[si + 1].split(',') : Array.from({ length: 30 }, (_, k) => String(k + 1));
const range = [-3, -2, -1, 0, 1, 2, 3];

function zone(): void {
  const vals: number[] = [];
  for (const s of seeds) for (const i of range) for (const j of range) {
    const r = cellRect(s, i, j);
    vals.push(zoneValue(s, Math.floor((r.x0 + r.x1) / 2), Math.floor((r.y0 + r.y1) / 2)));
  }
  vals.sort((a, b) => a - b);
  const n = vals.length, q = (p: number) => vals[Math.floor(p * (n - 1))].toFixed(2);
  const a = vals.filter(v => v >= ZONE_THRESHOLDS.downtown).length, c = vals.filter(v => v < ZONE_THRESHOLDS.residential).length;
  console.log(`zone value at ${n} cell centres: p5 ${q(0.05)} p50 ${q(0.5)} p95 ${q(0.95)}; downtown ${a} mixed ${n - a - c} residential ${c}`);
}

if (cmd === 'zone') zone();
else { console.error('usage: blockstats.ts zone [--seeds a,b,...]'); process.exit(1); }
