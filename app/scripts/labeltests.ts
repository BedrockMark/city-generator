// Stage 5: the user's good / bad labels as regression tests.
// Every label (references/labels/v*/seed*.json) is replayed against the current generator with the label's own
// options (seed, novelty, experiments; current pruning switches):
//   bad label  -> passes when the labelled thing is gone or changed (objects matched by sprite + position, regions
//                 by what stands in them); still there = failing test, listed with the constraints that see it
//   good label -> passes when the labelled thing is unchanged; changed = warning (did we break something liked?)
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from '../src/gen/generate';
import type { Label } from '../src/viewer/labels';
import type { Placed, PxRect, Scene, GenOptions } from '../src/gen/types';

const here = dirname(fileURLToPath(import.meta.url));
export const LABEL_DIR = join(here, '..', '..', 'references', 'labels');

export interface LabelResult { label: Label; file: string; status: 'pass' | 'fail' | 'warn'; detail: string; constraints: string[] }

export function loadLabels(): { file: string; label: Label }[] {
  if (!existsSync(LABEL_DIR)) return [];
  const out: { file: string; label: Label }[] = [];
  for (const v of readdirSync(LABEL_DIR)) {
    const d = join(LABEL_DIR, v);
    for (const f of readdirSync(d)) if (/^seed.*\.json$/.test(f) && !f.endsWith('.scene.json'))
      for (const label of (JSON.parse(readFileSync(join(d, f), 'utf8')).labels ?? []) as Label[]) out.push({ file: join(v, f), label });
  }
  return out;
}

const same = (o: Placed, s: { key: string; x: number; y: number }) => o.key === s.key && Math.abs(o.x - s.x) <= 2 && Math.abs(o.y - s.y) <= 2;
const centreIn = (o: Placed, r: PxRect) => { const cx = o.x + o.w / 2, cy = o.y + o.h / 2; return cx >= r.x0 && cx < r.x1 && cy >= r.y0 && cy < r.y1; };
/** what a region looks like: non-building things standing in it, its ground tiles and the keep-clear zones on it */
const regionSig = (sc: Scene, r: PxRect) => {
  const objs = sc.objects.filter(o => o.cls !== 'building' && centreIn(o, r)).map(o => `${o.key}@${o.x},${o.y}`).sort();
  const tiles: string[] = [];
  for (let y = Math.floor(r.y0 / 16); y < Math.ceil(r.y1 / 16); y++) for (let x = Math.floor(r.x0 / 16); x < Math.ceil(r.x1 / 16); x++) tiles.push(JSON.stringify(sc.ground.map(l => l[y]?.[x] ?? null)));
  const kc = (sc.zones ?? []).filter(z => z.layer === 'keepclear' && z.rect.x0 < r.x1 && r.x0 < z.rect.x1 && z.rect.y0 < r.y1 && r.y0 < z.rect.y1).map(z => `${z.kind}@${JSON.stringify(z.rect)}`).sort();
  return [...objs, ...tiles, ...kc].join('|');
};

export function runLabelTests(opts: Partial<GenOptions> = {}): LabelResult[] {
  const cache = new Map<string, Scene>();
  const out: LabelResult[] = [];
  for (const { file, label: l } of loadLabels()) {
    const o = { ...l.options, prune: true, pruneDraft: false, ...opts };
    const k = JSON.stringify([l.seed, o]);
    if (!cache.has(k)) cache.set(k, generate(l.seed, o));
    const sc = cache.get(k)!;
    const t = l.target;
    let present: boolean, detail: string;
    if (t.objects.length && t.kind !== 'region') {
      const still = t.objects.filter(s => sc.objects.some(p => same(p, s)));
      present = still.length === t.objects.length;
      detail = `${still.length}/${t.objects.length} 个被标注的物件仍在`;
    } else {
      // region: compare with the scene saved when labelling
      const saved = join(LABEL_DIR, `v${l.version}`, l.scene);
      if (existsSync(saved)) {
        const before = regionSig(JSON.parse(readFileSync(saved, 'utf8')) as Scene, t.rect), now = regionSig(sc, t.rect);
        present = before === now;
        detail = present ? '区域内的物件、地面和禁放区与标注时相同' : '区域内的物件 / 地面 / 禁放区已变化';
      } else {
        const still = t.objects.filter(s => sc.objects.some(p => same(p, s)));
        present = still.length === t.objects.length;
        detail = `（没有保存的场景）${still.length}/${t.objects.length} 个物件仍在`;
      }
    }
    const ov = (r: PxRect) => r.x0 < t.rect.x1 && t.rect.x0 < r.x1 && r.y0 < t.rect.y1 && t.rect.y0 < r.y1;
    const constraints = [...new Set((sc.audit?.violations ?? []).filter(v => ov(v.rect)).map(v => v.c))];
    const status = l.verdict === 'bad' ? (present ? 'fail' : 'pass') : (present ? 'pass' : 'warn');
    out.push({ label: l, file, status, detail, constraints });
  }
  return out;
}

export function formatLabelTests(rs: LabelResult[]): string[] {
  if (!rs.length) return ['标注测试：还没有标注（references/labels/ 为空）'];
  const n = (s: string, v: string) => rs.filter(r => r.status === s && r.label.verdict === v).length;
  const lines = [`标注测试：坏标注 ${n('pass', 'bad')} 已解决 / ${n('fail', 'bad')} 仍存在；好标注 ${n('pass', 'good')} 保持 / ${n('warn', 'good')} 被改动`];
  for (const r of rs) if (r.status !== 'pass') {
    const l = r.label;
    lines.push(`  ${r.status === 'fail' ? '✗ 坏标注仍存在' : '! 好标注被改动'} ${r.file} ${l.id}（${l.tags.join('、') || '无标签'}${l.text ? `：${l.text}` : ''}）— ${r.detail}${r.constraints.length ? `；覆盖它的约束：${r.constraints.join(', ')}` : '；没有约束看到它'}`);
  }
  return lines;
}
