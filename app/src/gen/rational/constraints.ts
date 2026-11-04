// Stage 5: declarative constraint list. Each entry = a rule kind from a small vocabulary + parameters.
// The list is data: docs/CONSTRAINTS.md is generated from it (scripts/constraints.ts doc), and the user decides
// per entry whether it is active, how severe it is and what the repair does.
//
// status: draft (measured and shown, never repairs) | active (repairs when pruning is on) | off (ignored)
// fix:    remove (delete the offending things) | downgrade (zone falls back to plain filling) | report (count only)
import { buildGraph, objectComps, rooted, type Graph } from './graph';
import { inRect, rectGap, rectsOverlap, grow, type World, type WObj, type Ground } from './world';
import { TILE as T, type PxRect } from '../types';

/** object selector: every given field must match */
export interface Sel {
  cls?: string[];
  /** regex on the sprite key */
  key?: string;
  person?: boolean; sit?: boolean;
  /** group types to include / exclude */
  group?: string[]; notGroup?: string[];
}

/** zone targets can reach `below` px further south (the sidewalk in front of a plaza); 'door-front' = the strip from
 *  a door down to the curb (±16 px, 64 px deep) */
export type Target = 'wall' | 'road' | 'door' | 'door-front' | { cls: string[] } | { key: string } | { zone: string[]; below?: number };

export type Rule =
  | { kind: 'door-open' }
  | { kind: 'door-street' }
  | { kind: 'leads-somewhere'; zones: string[]; to: string[] }
  | { kind: 'zone-reachable'; zones: string[]; keep: string[] }
  | { kind: 'reachable'; who: Sel }
  | { kind: 'front-open'; who: Sel; depth: number }
  | { kind: 'near'; who: Sel; to: Target[]; within: number }
  | { kind: 'on-ground'; who: Sel; ground: Ground[]; frac: number }
  | { kind: 'group-complete'; group: string; need: Sel[] }
  | { kind: 'not-inside'; who: Sel }
  | { kind: 'keep-clear'; zones: string[]; who: Sel; exempt?: string[]; exemptReason?: string }
  | { kind: 'anchor' }
  | { kind: 'banned'; who: Sel }
  | { kind: 'not-near'; who: Sel; to: Target[]; within: number; whole?: boolean }
  | { kind: 'door-path'; depth: number }
  | { kind: 'path-ends' }
  | { kind: 'path-redundant'; within: number }
  | { kind: 'mouth-gap'; zone: string; from: string; min: number }
  | { kind: 'occludes-door'; who: Sel };

export interface Constraint {
  id: string;
  title: string;
  /** why the rule exists (evidence: reference statistics, user remarks, labels) */
  why: string;
  severity: 'hard' | 'soft';
  fix: 'remove' | 'downgrade' | 'report';
  status: 'draft' | 'active' | 'off';
  rule: Rule;
  /** zone downgrade style */
  downgrade?: 'lawn' | 'clear';
}

const BINS = 'Trashbin|Dumpster';
const LITTER = '/Trash_\\d|Cardboard_Trash';
const USABLE: Sel = { cls: ['bench', 'table', 'kiosk', 'bus_stop', 'info_sign'] };

export const CONSTRAINTS: Constraint[] = [
  { id: 'C01', title: '门前可以站人', why: '门是建筑的“存在理由”之源；门前被物件堵住，门就失去意义。修复：删掉门前 24×14px 内挡路的物件（D17 门前禁放区的事后检查）',
    severity: 'hard', fix: 'remove', status: 'active', rule: { kind: 'door-open' } },
  { id: 'C02', title: '门连到街道', why: '从门出来能走到人行道、地图边缘或别的楼的门（穿楼而过）。例：广场的“长椅–中心树–长椅”一排横在朝内院的楼门前，把门围死（种子 33、50）。修复：删掉一个能打开通路的物件，优先删树（用户 2026-11-03：广场要删就删中心树，不降级），其次删最小的；只被建筑围住时只报告',
    severity: 'soft', fix: 'remove', status: 'active', rule: { kind: 'door-street' } },
  { id: 'C03', title: '过道 / 巷子通向某处', why: '用户反馈：楼间出现不通向任何地方的通道。过道除了街道之外，至少还要连到一块内院空间或一扇门；死胡同降级为草坪',
    severity: 'soft', fix: 'downgrade', downgrade: 'lawn', status: 'active', rule: { kind: 'leads-somewhere', zones: ['passage', 'alley'], to: ['garden', 'parking', 'driveway', 'service', 'forecourt', 'plaza', 'pocket', 'island', 'lot', 'passage', 'alley'] } },
  { id: 'C04', title: '有人用的内院空间可达', why: '花园、杂物角、楼前空地、广场要能从街道或门走进去；走不进去的只保留植物和围栏（宁删勿补）',
    severity: 'soft', fix: 'downgrade', downgrade: 'clear', status: 'active', rule: { kind: 'zone-reachable', zones: ['garden', 'service', 'forecourt', 'plaza', 'pocket', 'island', 'parking'], keep: ['tree', 'plant', 'fence'] } },
  { id: 'C05', title: '可使用的物件够得着', why: '长椅、桌子、售货亭、站亭、立牌旁边要有人能站的地方，并且连到街道 / 门',
    severity: 'soft', fix: 'remove', status: 'active', rule: { kind: 'reachable', who: USABLE } },
  { id: 'C06', title: '长椅前方不是墙', why: '长椅面朝的方向（D21）12px 内不能被墙、围栏或其他物件挡住',
    severity: 'hard', fix: 'remove', status: 'active', rule: { kind: 'front-open', who: { key: 'Bench_[1-7]$' }, depth: 12 } },
  { id: 'C07', title: '椅子挨着桌子', why: '参考图：座椅和桌子 lift 3.9，座位总围着桌子或摊位',
    severity: 'hard', fix: 'remove', status: 'active', rule: { kind: 'near', who: { key: 'Chair' }, to: [{ cls: ['table', 'kiosk'] }], within: 20 } },
  { id: 'C08', title: '坐着的人有座位', why: '参考图：坐姿的人 28px 内几乎都有桌子 / 长椅',
    severity: 'hard', fix: 'remove', status: 'active', rule: { kind: 'near', who: { person: true, sit: true }, to: [{ cls: ['bench', 'table', 'bus_stop'] }, { key: 'Chair' }], within: 14 } },
  { id: 'C09', title: '站着的人不在墙里或物件里', why: '人的脚不能踩在建筑碰撞体积或其他物件的占地上',
    severity: 'hard', fix: 'remove', status: 'active', rule: { kind: 'not-inside', who: { person: true, sit: false } } },
  { id: 'C10', title: '垃圾桶 / 垃圾箱靠边', why: '参考图：垃圾类靠建筑侧面、围栏、路缘或街角，不会孤零零立在空地中间。阈值取参考图的 95 百分位（离墙 / 马路 / 围栏 / 别的垃圾箱 39px）',
    severity: 'soft', fix: 'remove', status: 'active', rule: { kind: 'near', who: { key: BINS }, to: ['wall', 'road', 'door', { cls: ['fence', 'bus_stop'] }, { key: BINS }, { zone: ['passage', 'alley', 'service'] }], within: 40 } },
  { id: 'C11', title: '垃圾袋 / 废纸箱挨着垃圾桶或墙', why: '参考图：垃圾 + 垃圾 lift 4.2，垃圾袋散落在垃圾箱旁',
    severity: 'soft', fix: 'remove', status: 'active', rule: { kind: 'near', who: { key: LITTER }, to: ['wall', 'door', { key: BINS }, { cls: ['fence'] }], within: 28 } },
  { id: 'C12', title: '路缘设施贴着马路', why: '路灯、消防栓、咪表、红绿灯为马路服务，离路缘不超过 24px（广场灯除外）',
    severity: 'hard', fix: 'remove', status: 'active', rule: { kind: 'near', who: { cls: ['street_lamp', 'hydrant', 'traffic_light'], notGroup: ['plaza'] }, to: ['road'], within: 24 } },
  { id: 'C13', title: '车在马路或车位上', why: '车的占地至少 80% 在车行道 / 停车场地面上，不上人行道',
    severity: 'hard', fix: 'remove', status: 'active', rule: { kind: 'on-ground', who: { cls: ['vehicle'] }, ground: ['road', 'lot'], frac: 0.8 } },
  { id: 'C14', title: '公交站成组', why: '分析 3.2：候车亭、站牌、等车的人成组出现；缺了站亭或站牌的公交站整组删除',
    severity: 'hard', fix: 'remove', status: 'active', rule: { kind: 'group-complete', group: 'bus', need: [{ key: 'Bus_Stop_\\d$' }, { key: 'Bus_Stop_Sign' }] } },
  { id: 'C15', title: '横道口、车道口、停车通道、花园小路、人行道通行带不被占', why: '这些禁放区是通行的理由；同类小组的物件可以进入（街角的一根红绿灯杆同时服务两条横道），横道口和通行带只看人行道 / 马路上的部分；红绿灯、公交站和广场 / 小岛的中心物可以占通行带（小岛很小，中心物按画面居中时脚会落在环形人行道上）。标注 607718 L2：小岛广场两侧的树长在人行道通行带上',
    severity: 'hard', fix: 'remove', status: 'active', rule: { kind: 'keep-clear', zones: ['crossing', 'drive', 'aisle', 'path', 'walkway'], who: { person: false }, exempt: ['crossing', 'bus'], exemptReason: '中心物' } },
  { id: 'C16', title: '锚点仍然存在（存在理由可追溯）', why: '物件的锚点是另一个物件（椅子→桌子、坐着的人→长椅）时，锚点被删，它也跟着删',
    severity: 'hard', fix: 'remove', status: 'active', rule: { kind: 'anchor' } },
  // ---- from the user's labels (references/labels/v0.4.0) ----
  { id: 'C17', title: '禁用贴图', why: '标注 684358 L3：空调外机不应出现在地面上（平房屋顶上的空调外机是实验功能 exp-01，不受此限）；406829 L3：Shrub_3 看不清是什么。名单由用户维护',
    severity: 'hard', fix: 'remove', status: 'active', rule: { kind: 'banned', who: { key: 'Air_Conditioner|/Shrub_3$', notGroup: ['rooftop'] } } },
  { id: 'C18', title: '门前有路通到人行道', why: '标注 994257 L3/L4/L5：“应该有一条路到门口”。从门到最近的人行道、小路或广场要有一条路（优先走铺地、少转弯，不穿过楼的底层占地；楼的高层不占地，D38），路线上不能是草坪，也不能放盆栽。修复：删掉挡路的物件，揭掉路线上的草坪（下面本来就是铺地）；走不出去时只报告',
    severity: 'soft', fix: 'remove', status: 'active', rule: { kind: 'door-path', depth: 12 } },
  { id: 'C20', title: '花园小路不和人行道并行', why: '标注 684358 L4：离人行道很近、又不属于更大的内院，这条路是多余的。修复：小路改成草坪，面朝它的长椅和路上的行人一起删',
    severity: 'soft', fix: 'remove', status: 'active', rule: { kind: 'path-redundant', within: 40 } },
  { id: 'C19', title: '花园小路不断头', why: '标注 838592 L1、607718 L3（坏）、161781 L1（好）：小路一头撞上楼的墙（底层占地）= 不通向任何地方。楼后的地面是普通内院，小路可以照常穿过（D38）。只报告：阶段 6 换子种子重生成',
    severity: 'soft', fix: 'report', status: 'active', rule: { kind: 'path-ends' } },
  { id: 'C21', title: '行道树不挤在广场前和门前', why: '标注 359866 L2、994257 L2：小广场前面、店门前面再种行道树就太挤（广场本身有中心树）',
    severity: 'soft', fix: 'remove', status: 'active', rule: { kind: 'not-near', who: { group: ['curb-trees'] }, to: [{ zone: ['plaza'], below: 64 }, 'door-front'], within: 0 } },
  { id: 'C22', title: '道路施工不占横道', why: '标注 941983 L1：施工的坑挖在人行横道上，没有理由。修复：整组施工删除',
    severity: 'hard', fix: 'remove', status: 'active', rule: { kind: 'not-near', who: { group: ['works'] }, to: [{ zone: ['zebra'] }], within: 4, whole: true } },
  { id: 'C23', title: '停车场车道口离横道远一点', why: '标注 941983 L2：车道口紧挨着路口的横道。车道口和横道至少隔 2 格。事后无法挪车道，只报告（建议在生成时让车道候选避开路口、优先居中）',
    severity: 'soft', fix: 'report', status: 'active', rule: { kind: 'mouth-gap', zone: 'driveway', from: 'zebra', min: 32 } },
  { id: 'C24', title: '大物件不挡住门', why: '标注 406829 L2：广场的巨型冰淇淋亭挡住了后面公寓的门（同一个亭子被标为“好”，问题在位置）。只报告：删掉会违背好标注',
    severity: 'soft', fix: 'report', status: 'active', rule: { kind: 'occludes-door', who: { notGroup: ['front'] } } },
];

// ------------------------------------------------------------------------------------------------

export interface Violation {
  c: string;
  /** what is wrong: object id, door "<building>.door<i>", zone id, group gid */
  target: string;
  /** objects the repair would delete */
  objs: string[];
  /** zone to downgrade (repair) */
  zone?: string;
  rect: PxRect;
  msg: string;
  /** ground repairs: grass overlay to remove (a paved way shows through), rects to turn into lawn, paving to lay */
  clearLawn?: PxRect[];
  toLawn?: PxRect[];
  pave?: { cell: [number, number]; src: [number, number] }[];
  /** keep-clear zones that lose their reason with the repair */
  dropZones?: string[];
}

export interface Ctx { w: World; g: Graph; byId: Map<string, WObj> }

export function makeCtx(w: World): Ctx { return { w, g: buildGraph(w), byId: new Map(w.objs.map(o => [o.id, o])) }; }

export function selects(s: Sel, o: WObj): boolean {
  if (s.person !== undefined && s.person !== o.person) return false;
  if (s.sit !== undefined && s.sit !== o.sit) return false;
  if (s.cls && !s.cls.includes(o.cls)) return false;
  if (s.key && !new RegExp(s.key).test(o.key)) return false;
  if (s.group && !s.group.includes(o.group ?? '')) return false;
  if (s.notGroup && s.notGroup.includes(o.group ?? '')) return false;
  return true;
}

const ground = (o: WObj): PxRect => o.fp ?? { x0: o.bb.x0, y0: o.bb.y1 - 4, x1: o.bb.x1, y1: o.bb.y1 };

/** distance from an object's ground box to the nearest target */
export function distTo(cx: Ctx, o: WObj, t: Target, within: number): number {
  const r = ground(o);
  if (t === 'wall') return Math.min(Infinity, ...cx.w.walls.filter(wr => rectGap(wr, r) <= within).map(wr => rectGap(wr, r)));
  if (t === 'door') return Math.min(Infinity, ...cx.w.doors.map(d => rectGap({ x0: d.x - 12, y0: d.y - 2, x1: d.x + 12, y1: d.y + 2 }, r)));
  if (t === 'door-front') return Math.min(Infinity, ...cx.w.doors.map(d => rectGap({ x0: d.x - 16, y0: d.y, x1: d.x + 16, y1: d.y + 64 }, r)));
  if (t === 'road') {
    let best = Infinity;
    for (let y = Math.floor(r.y0 - within); y <= r.y1 + within; y += 2) for (let x = Math.floor(r.x0 - within); x <= r.x1 + within; x += 2) {
      if (cx.w.ground(x, y) !== 'road') continue;
      const d = rectGap(r, { x0: x, y0: y, x1: x + 1, y1: y + 1 }); if (d < best) best = d;
    }
    return best;
  }
  if ('zone' in t) return Math.min(Infinity, ...cx.w.zones.filter(z => t.zone.includes(z.kind)).map(z => rectGap({ ...z.rect, y1: z.rect.y1 + (t.below ?? 0) }, r)));
  const sel: Sel = 'cls' in t ? { cls: t.cls } : { key: t.key };
  return Math.min(Infinity, ...cx.w.objs.filter(p => p !== o && selects(sel, p)).map(p => rectGap(ground(p), r)));
}

/** which way a bench faces (D21) */
function benchFacing(key: string): 'S' | 'N' | 'W' | 'E' | null {
  const m = key.match(/Bench_(\d+)$/); if (!m) return null;
  return ({ 1: 'S', 2: 'S', 7: 'N', 3: 'W', 5: 'W', 4: 'E', 6: 'E' } as Record<string, 'S' | 'N' | 'W' | 'E'>)[m[1]] ?? null;
}
function frontStrip(o: WObj, d: number): PxRect | null {
  const f = benchFacing(o.key), fp = ground(o);
  if (f === 'S') return { x0: fp.x0, y0: fp.y1, x1: fp.x1, y1: fp.y1 + d };
  if (f === 'N') return { x0: fp.x0, y0: o.bb.y0 - d, x1: fp.x1, y1: o.bb.y0 + 2 };
  if (f === 'W') return { x0: fp.x0 - d, y0: fp.y1 - 14, x1: fp.x0, y1: fp.y1 };
  if (f === 'E') return { x0: fp.x1, y0: fp.y1 - 14, x1: fp.x1 + d, y1: fp.y1 };
  return null;
}
const NOT_OBSTACLE = new Set(['person', 'manhole', 'table']);

function blockedFrac(cx: Ctx, r: PxRect, self: WObj): number {
  let n = 0, b = 0;
  const obst = [...cx.w.walls, ...cx.w.objs.filter(p => p !== self && p.fp && !NOT_OBSTACLE.has(p.cls)).map(p => p.fp!)].filter(q => rectsOverlap(q, r));
  for (let y = r.y0 + 1; y < r.y1; y += 2) for (let x = r.x0 + 1; x < r.x1; x += 2) {
    n++;
    if (obst.some(q => inRect(q, x, y))) b++;
  }
  return n ? b / n : 0;
}

/** paved public space a door may open onto */
const OPEN_PAVED = new Set(['plaza', 'island', 'alley', 'forecourt', 'pocket']);
const zoneById = (cx: Ctx, id: string) => cx.w.zones.find(z => z.id === id);
const gidMembers = (cx: Ctx, gid: string | undefined) => gid ? cx.w.objs.filter(o => o.gid === gid) : [];

export function evaluate(c: Constraint, cx: Ctx): Violation[] {
  const { w, g } = cx;
  const out: Violation[] = [];
  const V = (target: string, objs: string[], rect: PxRect, msg: string, zone?: string) => out.push({ c: c.id, target, objs, rect, msg, zone });
  const r = c.rule;
  switch (r.kind) {
    case 'door-open': {
      for (const [i, d] of g.doors.entries()) {
        if (d.comp >= 0) continue;
        if (w.ground(d.x, d.y + 4) === 'road' || w.ground(d.x, d.y + 4) === 'none') continue;   // facade right on the road / off-map
        const step: PxRect = { x0: d.x - 12, y0: d.y, x1: d.x + 12, y1: d.y + 14 };
        const blockers = w.objs.filter(o => o.fp && !o.person && rectsOverlap(o.fp, step));
        V(`${d.bid}.door${i}`, blockers.map(o => o.id), step, `${d.bid} 的门前没有可站的地方${blockers.length ? `（被 ${blockers.map(o => o.key.split('/').pop()).join('、')} 挡住）` : '（被墙或地块边缘挡住）'}`);
      }
      break;
    }
    case 'door-street': {
      // out = street, map edge, or another building's door (through that building); the door's own pocket does not count
      const outOf = (gg: Graph, k: number, bid: string) => gg.compRoots[k].has('street') || gg.compRoots[k].has('edge') || gg.doors.some(e => e.comp === k && e.bid !== bid);
      for (const [i, d] of g.doors.entries()) {
        if (d.comp < 0 || outOf(g, d.comp, d.bid)) continue;
        const step = { x0: d.x - 8, y0: d.y, x1: d.x + 8, y1: d.y + 12 };
        // repair: a single object around the pocket whose removal lets the door out; trees first (the user would rather
        // lose a plaza's centre tree than one of its benches), then the smallest
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let k = 0; k < g.comp.length; k++) if (g.comp[k] === d.comp) { const x = (k % g.gw) * 4, y = Math.floor(k / g.gw) * 4; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 4); y1 = Math.max(y1, y + 4); }
        const around = grow({ x0, y0, x1, y1 }, 12);
        const cands = w.objs.filter(o => o.fp && !o.person && rectsOverlap(o.fp, around))
          .sort((a, b) => +(a.cls !== 'tree') - +(b.cls !== 'tree') || (a.fp!.x1 - a.fp!.x0) * (a.fp!.y1 - a.fp!.y0) - (b.fp!.x1 - b.fp!.x0) * (b.fp!.y1 - b.fp!.y0));
        const opener = cands.find(o => {
          const g2 = buildGraph(w, { ignore: new Set([o.id]) });
          const d2 = g2.doors[i];
          return d2.comp >= 0 && outOf(g2, d2.comp, d.bid);
        });
        const others = g.doors.filter(e => e.comp === d.comp && e.bid !== d.bid).map(e => e.bid);
        V(`${d.bid}.door${i}`, opener ? [opener.id] : [], step, `${d.bid} 的门走不到街上${opener ? `：被 ${cands.filter(o => rectsOverlap(o.fp!, around)).map(o => o.key.split('/').pop()).join('、')} 围住，删掉 ${opener.key.split('/').pop()}（${opener.gid}）就能出去` : others.length ? `（只连到 ${others.join('、')} 的门）` : '（被建筑完全围住，删物件也打不开）'}`);
      }
      break;
    }
    case 'leads-somewhere': {
      for (const p of g.places) {
        if (!p.zone || !r.zones.includes(p.kind)) continue;
        const nb = [...g.links.keys()].map(k => k.split(',').map(Number)).filter(([a, b]) => a === p.id || b === p.id).map(([a, b]) => g.places[a === p.id ? b : a]);
        const toStreet = nb.some(q => q.kind === 'street');
        const elsewhere = nb.filter(q => r.to.includes(q.kind));
        const door = g.doors.some(d => d.place === p.id);
        if (elsewhere.length || door) continue;
        const zgid = p.zone.gid;
        V(p.zone.id, gidMembers(cx, zgid).map(o => o.id), p.zone.rect, `${p.kind === 'passage' ? '过道' : '巷子'}（${Math.round((p.zone.rect.x1 - p.zone.rect.x0) / 16)}×${Math.round((p.zone.rect.y1 - p.zone.rect.y0) / 16)} 格）${toStreet ? '只通到街上' : '哪儿也不通'}，尽头没有内院、也没有门：死胡同${nb.some(q => q.kind !== 'street') ? `（只挨着 ${[...new Set(nb.filter(q => q.kind !== 'street').map(q => q.kind))].join('、')}）` : ''}`, p.zone.id);
      }
      break;
    }
    case 'zone-reachable': {
      for (const p of g.places) {
        if (!p.zone || !r.zones.includes(p.kind)) continue;
        if ([...p.comps].some(k => rooted(g, k))) continue;
        const members = gidMembers(cx, p.zone.gid).filter(o => !r.keep.includes(o.cls));
        if (!members.length && !p.comps.size) continue;
        V(p.zone.id, members.map(o => o.id), p.zone.rect, `${p.kind}（${p.zone.id}）走不进去：没有连到街道、地图边缘或任何门的通路`, p.zone.id);
      }
      break;
    }
    case 'reachable': {
      for (const o of w.objs) {
        if (!selects(r.who, o)) continue;
        const comps = objectComps(g, o);
        if ([...comps].some(k => rooted(g, k))) continue;
        V(o.id, [o.id], ground(o), comps.size ? `${o.key.split('/').pop()} 旁边能站人的地方连不到街道 / 门` : `${o.key.split('/').pop()} 四周没有能站人的地方`);
      }
      break;
    }
    case 'front-open': {
      for (const o of w.objs) {
        if (!selects(r.who, o)) continue;
        const s = frontStrip(o, r.depth); if (!s) continue;
        const f = blockedFrac(cx, s, o);
        if (f > 0.5) V(o.id, [o.id], s, `${o.key.split('/').pop()} 面前 ${r.depth}px 有 ${Math.round(f * 100)}% 被墙或物件挡住`);
      }
      break;
    }
    case 'near': {
      for (const o of w.objs) {
        if (!selects(r.who, o)) continue;
        const d = Math.min(...r.to.map(t => distTo(cx, o, t, r.within)));
        if (d > r.within) V(o.id, [o.id], ground(o), `${o.person ? '坐着的人' : o.key.split('/').pop()} 离最近的${describeTargets(r.to)}${d === Infinity ? '太远（范围内没有）' : ` ${Math.round(d)}px`}，超过 ${r.within}px`);
      }
      break;
    }
    case 'on-ground': {
      for (const o of w.objs) {
        if (!selects(r.who, o) || !o.fp) continue;
        let n = 0, ok = 0;
        for (let y = o.fp.y0 + 1; y < o.fp.y1; y += 2) for (let x = o.fp.x0 + 1; x < o.fp.x1; x += 2) { n++; if (r.ground.includes(w.ground(x, y))) ok++; }
        if (n && ok / n < r.frac) V(o.id, [o.id], o.fp, `${o.key.split('/').pop()} 只有 ${Math.round(ok / n * 100)}% 在${r.ground.join(' / ')}上`);
      }
      break;
    }
    case 'group-complete': {
      const gids = new Set(w.objs.filter(o => o.group === r.group).map(o => o.gid!));
      for (const gid of gids) {
        const mem = gidMembers(cx, gid);
        const missing = r.need.filter(s => !mem.some(o => selects(s, o)));
        if (missing.length) V(gid, mem.map(o => o.id), union(mem.map(ground)), `${gid} 不完整：缺 ${missing.map(s => s.key ?? s.cls?.join('/')).join('、')}`);
      }
      break;
    }
    case 'not-inside': {
      for (const o of w.objs) {
        if (!selects(r.who, o)) continue;
        const foot: PxRect = { x0: o.fx - 3, y0: o.fy - 3, x1: o.fx + 3, y1: o.fy };
        const wall = w.walls.some(q => rectsOverlap(q, foot));
        const obj = w.objs.find(p => p !== o && !p.person && p.fp && !NOT_OBSTACLE.has(p.cls) && rectsOverlap(p.fp, foot));
        if (wall || obj) V(o.id, [o.id], foot, `人的脚踩在${wall ? '建筑碰撞体积' : obj!.key.split('/').pop()}里`);
      }
      break;
    }
    case 'keep-clear': {
      for (const z of w.zones) {
        if (z.layer !== 'keepclear' || !r.zones.includes(z.kind)) continue;
        for (const o of w.objs) {
          if (r.exempt?.includes(o.group ?? '') || (r.exemptReason && new RegExp(r.exemptReason).test(o.reason ?? ''))) continue;
          // the zone's own kind of group may use it (a corner pole serves both crossings); only the pedestrian
          // ground counts (a shrub on the lawn behind the sidewalk end does not block the crossing)
          if (!selects(r.who, o) || !o.fp || !rectsOverlap(o.fp, z.rect)) continue;
          if (z.gid && o.group === z.gid.split(/[#:]/)[0]) continue;
          const g = w.ground((o.fp.x0 + o.fp.x1) / 2, (o.fp.y0 + o.fp.y1) / 2);
          if (g !== 'walk' && g !== 'road' && (z.kind === 'crossing' || z.kind === 'walkway')) continue;
          V(o.id, [o.id], o.fp, `${o.key.split('/').pop()} 占了禁放区“${z.kind}”（${z.reason}）`);
        }
      }
      break;
    }
    case 'anchor': {
      // object anchors are points on another object's foot; the referenced object must still exist
      for (const o of w.objs) {
        const a = o.anchor; if (!a || a.kind !== 'object') continue;
        const ok = w.objs.some(p => p !== o && Math.abs(p.fx - a.x) <= 6 && Math.abs(p.fy - a.y) <= 8)
          || w.objs.some(p => p !== o && p.fp && inRect(grow(p.fp, 6), a.x, a.y));
        if (!ok) V(o.id, [o.id], ground(o), `锚点 ${a.ref} 已不存在`);
      }
      break;
    }
    case 'banned': {
      for (const o of w.objs) if (selects(r.who, o)) V(o.id, [o.id], ground(o), `${o.key.split('/').pop()} 在禁用名单里`);
      break;
    }
    case 'not-near': {
      for (const o of w.objs) {
        if (!selects(r.who, o)) continue;
        const d = Math.min(...r.to.map(t => distTo(cx, o, t, r.within + 1)));
        if (d > r.within) continue;
        const mem = r.whole && o.gid ? gidMembers(cx, o.gid) : [o];
        V(r.whole && o.gid ? o.gid : o.id, mem.map(m => m.id), ground(o), `${o.key.split('/').pop()}（${o.gid}）离${describeTargets(r.to)}只有 ${Math.round(d)}px`);
      }
      break;
    }
    case 'door-path': {
      // a door needs a way to the sidewalk / a path / paved public space: the cheapest route over the cells of the
      // lot (not through building footprints), preferring paving over lawn, free cells over
      // occupied ones, and few turns. On that route nothing may stand and no lawn may lie.
      const GW = Math.ceil(w.W / T), GH = Math.ceil(w.H / T);
      const at = (x: number, y: number) => ({ px: x * T + 8, py: y * T + 8 });
      const goal = (x: number, y: number) => {
        const { px, py } = at(x, y);
        return w.ground(px, py) === 'walk' || w.zones.some(z => ((z.layer === 'keepclear' && z.kind === 'path') || OPEN_PAVED.has(z.kind)) && inRect(z.rect, px, py));
      };
      const pass = (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= GW || y >= GH) return false;
        const { px, py } = at(x, y);
        return w.ground(px, py) === 'lot' && !w.walls.some(q => inRect(q, px, py));
      };
      const cellR = (x: number, y: number): PxRect => ({ x0: x * T + 3, y0: y * T + 3, x1: x * T + T - 3, y1: y * T + T - 3 });
      const occupants = (x: number, y: number) => w.objs.filter(o => o.fp && !o.person && rectsOverlap(o.fp, cellR(x, y)));
      for (const [i, d] of w.doors.entries()) {
        const sx = Math.floor(d.x / T), sy = Math.floor(d.y / T);
        if (!pass(sx, sy)) continue;                       // the door opens straight onto the sidewalk / a plaza / nothing
        // Dijkstra over (cell, heading); small grids, short routes
        const key = (x: number, y: number, h: number) => (y * GW + x) * 4 + h;
        const dist = new Map<number, number>(), prev = new Map<number, number>();
        const open: [number, number, number, number][] = [[0, sx, sy, 1]];   // cost, x, y, heading (1 = down)
        dist.set(key(sx, sy, 1), 0);
        const DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]];
        let found = -1;
        while (open.length) {
          open.sort((a, b) => a[0] - b[0]);
          const [cost, x, y, h] = open.shift()!;
          if (cost > (dist.get(key(x, y, h)) ?? Infinity) || cost > r.depth * 3) continue;
          if (goal(x, y)) { found = key(x, y, h); break; }
          for (const [hi, [dx, dy]] of DIRS.entries()) {
            const nx = x + dx, ny = y + dy;
            if (!goal(nx, ny) && !pass(nx, ny)) continue;
            const c2 = cost + 1 + (hi !== h ? 0.5 : 0) + (goal(nx, ny) ? 0 : (w.lawn(nx * T + 8, ny * T + 8) ? 1 : 0) + occupants(nx, ny).length * 4);
            const k2 = key(nx, ny, hi);
            if (c2 < (dist.get(k2) ?? Infinity)) { dist.set(k2, c2); prev.set(k2, key(x, y, h)); open.push([c2, nx, ny, hi]); }
          }
        }
        if (found < 0) { V(`${d.bid}.door${i}`, [], { x0: d.x - 8, y0: d.y, x1: d.x + 8, y1: d.y + 16 }, `${d.bid} 的门走不到人行道、小路或广场（中间都是楼）`); continue; }
        const route: [number, number][] = [];
        for (let k: number | undefined = prev.get(found); k !== undefined; k = prev.get(k)) { const c0 = Math.floor(k / 4); route.push([c0 % GW, Math.floor(c0 / GW)]); }
        const blockers = [...new Set(route.flatMap(([x, y]) => occupants(x, y)))];
        const lawnCells = route.filter(([x, y]) => w.lawn(x * T + 8, y * T + 8)).map(([x, y]) => ({ x0: x * T, y0: y * T, x1: x * T + T, y1: y * T + T }));
        if (!blockers.length && !lawnCells.length) continue;
        const what = [blockers.length ? `被 ${blockers.map(o => o.key.split('/').pop()).join('、')} 挡住` : '', lawnCells.length ? `${lawnCells.length} 格是草坪` : ''].filter(Boolean).join('，');
        out.push({ c: c.id, target: `${d.bid}.door${i}`, objs: blockers.map(o => o.id), rect: union(route.map(([x, y]) => ({ x0: x * T, y0: y * T, x1: x * T + T, y1: y * T + T }))), clearLawn: lawnCells,
          msg: `${d.bid} 的门到人行道 / 小路的 ${route.length} 格没有路：${what}` });
      }
      break;
    }
    case 'path-ends': {
      // what lies right past each end of a garden path: a street, another path, a door, the map edge or open yard
      // are fine; a wall without a door means the path leads nowhere
      for (const z of w.zones) {
        if (z.layer !== 'keepclear' || z.kind !== 'path') continue;
        const horiz = z.rect.x1 - z.rect.x0 > z.rect.y1 - z.rect.y0;
        const line = horiz ? Math.floor((z.rect.y0 + z.rect.y1) / 2 / T) : Math.floor((z.rect.x0 + z.rect.x1) / 2 / T);
        const a0 = horiz ? Math.floor(z.rect.x0 / T) : Math.floor(z.rect.y0 / T), a1 = horiz ? Math.ceil(z.rect.x1 / T) - 1 : Math.ceil(z.rect.y1 / T) - 1;
        for (const dir of [-1, 1]) {
          const k = dir < 0 ? a0 - 1 : a1 + 1;
          const [x, y] = horiz ? [k, line] : [line, k];
          const px = x * T + 8, py = y * T + 8;
          if (!w.walls.some(q => inRect(q, px, py)) || w.doors.some(d => Math.abs(d.x - px) <= 16 && Math.abs(d.y - py) <= 24)) continue;
          const e = dir < 0 ? a0 : a1;
          const endRect: PxRect = horiz ? { x0: e * T, y0: line * T, x1: e * T + T, y1: line * T + T } : { x0: line * T, y0: e * T, x1: line * T + T, y1: e * T + T };
          V(`${z.id}/${dir < 0 ? 'start' : 'end'}`, [], endRect, `花园小路（${z.gid}）一头直接撞上楼的墙，不通向任何地方`);
        }
      }
      break;
    }
    case 'path-redundant': {
      for (const z of w.zones) {
        if (z.layer !== 'keepclear' || z.kind !== 'path') continue;
        const horiz = z.rect.x1 - z.rect.x0 > z.rect.y1 - z.rect.y0;
        const mid = horiz ? (z.rect.y0 + z.rect.y1) / 2 : (z.rect.x0 + z.rect.x1) / 2;
        const a0 = horiz ? z.rect.x0 : z.rect.y0, a1 = horiz ? z.rect.x1 : z.rect.y1;
        let all = true;
        for (let a = a0 + 8; a < a1 && all; a += 16) {
          let near = false;
          for (let d = 8; d <= r.within && !near; d += 4) for (const sgn of [-1, 1]) {
            const [px, py] = horiz ? [a, mid + sgn * d] : [mid + sgn * d, a];
            if (w.ground(px, py) === 'walk') { near = true; break; }
          }
          if (!near) all = false;
        }
        if (!all) continue;
        const garden = w.zones.find(q => q.layer === 'yard' && q.gid === z.gid);
        const lawnR = garden ? { x0: Math.max(garden.rect.x0, Math.floor(z.rect.x0 / T) * T), y0: Math.max(garden.rect.y0, Math.floor(z.rect.y0 / T) * T), x1: Math.min(garden.rect.x1, Math.ceil(z.rect.x1 / T) * T), y1: Math.min(garden.rect.y1, Math.ceil(z.rect.y1 / T) * T) } : z.rect;
        const users = w.objs.filter(o => o.anchor?.ref === `${z.gid}/path`);
        out.push({ c: c.id, target: z.id, objs: users.map(o => o.id), rect: z.rect, toLawn: [lawnR], dropZones: [z.id],
          msg: `花园小路（${z.gid}）和人行道平行、相距不到 ${r.within}px：多余的路，改成草坪${users.length ? `（连同面朝它的 ${users.map(o => o.key.split('/').pop()).join('、')}）` : ''}` });
      }
      break;
    }
    case 'mouth-gap': {
      for (const z of w.zones) {
        if (z.kind !== r.zone) continue;
        const d = Math.min(Infinity, ...w.zones.filter(q => q.kind === r.from).map(q => rectGap(q.rect, z.rect)));
        if (d < r.min) V(z.id, [], z.rect, `${z.kind}（${z.gid ?? z.id}）离${r.from}只有 ${Math.round(d)}px（至少 ${r.min}px）`);
      }
      break;
    }
    case 'occludes-door': {
      for (const [i, d] of w.doors.entries()) {
        const occ = w.objs.filter(o => selects(r.who, o) && !o.person && o.fy > d.y && inRect(o.bb, d.x, d.y - 12));
        if (occ.length) V(`${d.bid}.door${i}`, [], { x0: d.x - 12, y0: d.y - 32, x1: d.x + 12, y1: d.y }, `${d.bid} 的门被前面的 ${occ.map(o => `${o.key.split('/').pop()}（${o.gid}）`).join('、')} 挡住看不见`);
      }
      break;
    }
  }
  return out;
}

/** how many things the rule looked at (denominator of the pass rate) */
export function subjects(c: Constraint, cx: Ctx): number {
  const r = c.rule, { w, g } = cx;
  switch (r.kind) {
    case 'door-open': case 'door-street': return g.doors.length;
    case 'leads-somewhere': case 'zone-reachable': return g.places.filter(p => p.zone && r.zones.includes(p.kind)).length;
    case 'group-complete': return new Set(w.objs.filter(o => o.group === r.group).map(o => o.gid)).size;
    case 'keep-clear': return w.zones.filter(z => z.layer === 'keepclear' && r.zones.includes(z.kind)).length;
    case 'anchor': return w.objs.filter(o => o.anchor?.kind === 'object').length;
    case 'door-path': case 'occludes-door': return w.doors.length;
    case 'path-ends': return 2 * w.zones.filter(z => z.layer === 'keepclear' && z.kind === 'path').length;
    case 'path-redundant': return w.zones.filter(z => z.layer === 'keepclear' && z.kind === 'path').length;
    case 'mouth-gap': return w.zones.filter(z => z.kind === r.zone).length;
    case 'front-open': return w.objs.filter(o => selects(r.who, o) && benchFacing(o.key)).length;
    case 'on-ground': return w.objs.filter(o => selects(r.who, o) && o.fp).length;
    default: return w.objs.filter(o => selects(r.who, o)).length;
  }
}

function describeTargets(ts: Target[]): string {
  return ts.map(t => t === 'wall' ? '墙' : t === 'road' ? '马路' : t === 'door' ? '门' : t === 'door-front' ? '门前' : 'zone' in t ? t.zone.join('/') + (t.below ? '（及其前方）' : '') : 'cls' in t ? t.cls.join('/') : t.key.replace(/\\/g, '')).join(' / ');
}
export const union = (rs: PxRect[]): PxRect => rs.length ? rs.reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) })) : { x0: 0, y0: 0, x1: 0, y1: 0 };

/** does the rule make sense on an analysed reference? References carry no doors, zones, groups or people
 *  (door / zone targets simply never match there, which makes those rules slightly stricter on references) */
export function appliesToRefs(c: Constraint): boolean {
  const r = c.rule;
  // on-ground is not: reference ground classes come from tile colour, and painted parking bays read as pavement
  return (r.kind === 'reachable' || r.kind === 'front-open' || r.kind === 'near') && !r.who.person && !(r.kind === 'near' && r.to.includes('door-front'));
}
