// Stage 5: declarative constraint list. Each entry = a rule kind from a small vocabulary + parameters.
// The list is data: docs/reports/CONSTRAINTS.md is generated from it (scripts/constraints.ts doc), and the user decides
// per entry whether it is active, how severe it is and what the repair does.
//
// status: draft (measured and shown, never repairs) | active (repairs when pruning is on) | off (ignored)
// fix:    remove (delete the offending things) | downgrade (zone falls back to plain filling) | report (count only)
import { buildGraph, objectComps, rooted, G, type Graph } from './graph';
import { inRect, rectGap, rectsOverlap, grow, type World, type WObj, type Ground } from './world';
import { TILE as T, type PxRect, type ZoneRec } from '../types';

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
  | { kind: 'dead-end'; reach: number }
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
  /** belongs to an experimental feature: judged and repaired only while that experiment is on, its repairs carry the tag */
  exp?: string;
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
    severity: 'hard', fix: 'remove', status: 'active', rule: { kind: 'keep-clear', zones: ['crossing', 'drive', 'aisle', 'path', 'link', 'walkway'], who: { person: false }, exempt: ['crossing', 'bus'], exemptReason: '中心物' } },
  { id: 'C16', title: '锚点仍然存在（存在理由可追溯）', why: '物件的锚点是另一个物件（椅子→桌子、坐着的人→长椅）时，锚点被删，它也跟着删',
    severity: 'hard', fix: 'remove', status: 'active', rule: { kind: 'anchor' } },
  // ---- from the user's labels (references/labels/v0.4.0) ----
  { id: 'C17', title: '禁用贴图', why: '标注 684358 L3：空调外机不应出现在地面上（平房屋顶上的空调外机是 exp-01，已转正，不受此限）；406829 L3：Shrub_3 看不清是什么。名单由用户维护',
    severity: 'hard', fix: 'remove', status: 'active', rule: { kind: 'banned', who: { key: 'Air_Conditioner|/Shrub_3$', notGroup: ['rooftop'] } } },
  { id: 'C18', title: '门前有路通到人行道', why: '标注 994257 L3/L4/L5：“应该有一条路到门口”。从门到最近的人行道、小路或广场要有一条路（优先走铺地、少转弯，不穿过楼的底层占地；楼的高层不占地，D38），路线上不能是草坪，也不能放盆栽。修复：删掉挡路的物件，揭掉路线上的草坪（下面本来就是铺地）；走不出去时只报告',
    severity: 'soft', fix: 'remove', status: 'active', rule: { kind: 'door-path', depth: 12 } },
  { id: 'C20', title: '花园小路不和人行道并行', why: '标注 684358 L4：离人行道很近、又不属于更大的内院，这条路是多余的。修复：小路改成草坪，面朝它的长椅和路上的行人一起删',
    severity: 'soft', fix: 'remove', status: 'active', rule: { kind: 'path-redundant', within: 40 } },
  { id: 'C19', title: '花园小路不断头', why: '标注 838592 L1、607718 L3（坏）、161781 L1（好）：小路一头撞上楼的墙（底层占地）= 不通向任何地方。楼后的地面是普通内院，小路可以照常穿过（D38）。只报告：阶段 6 换子种子重生成',
    severity: 'soft', fix: 'report', status: 'active', rule: { kind: 'path-ends' } },
  { id: 'C25', title: '断头路先接上，接不上就删', why: '标注 464294 L1（坏）：“如果一条路不通向任何地方，则应该删除”；用户：很多只要往后去一点就能到停车场 / 街另一边。花园小路或巷子能看见的一头撞墙、钻进楼的高层底下或停在草坪上，就是断头路。先接：每个断头往前找一条 ≤6 格的路，接到人行道、别的小路或连着街的铺地（不穿楼、不钻到楼的高层底下、不碰树干、不挪长椅；挡路的盆栽、垃圾袋和行人删掉）。接上要有用：不接到另一条断头路上；原来就能走到的地方（这条路已经通的一头，或两头都断时另一条接线的去处）不算新去处，绕现有的路走过去要超过经这条路走的 1.5 倍才算；接上后，路上伸进楼底下看不见的一段改成草坪。接不上：整条小路改成草坪（连同面朝它的长椅和路上的行人），巷子降级为草坪（连同垃圾桶）。exp-07',
    severity: 'soft', fix: 'downgrade', downgrade: 'lawn', status: 'active', exp: 'exp-07', rule: { kind: 'dead-end', reach: 6 } },
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
  /** zones the repair adds (a path continued: its new stretch); ids are given by the repair */
  addZones?: Omit<ZoneRec, 'id'>[];
}

export interface Ctx { w: World; g: Graph; byId: Map<string, WObj>;
  /** exp-07 on: door walks (C18) keep out from under upper floors where they can */
  seenWalks?: boolean }

export function makeCtx(w: World, o: { seenWalks?: boolean } = {}): Ctx { return { w, g: buildGraph(w), byId: new Map(w.objs.map(o => [o.id, o])), seenWalks: o.seenWalks }; }

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
        return w.ground(px, py) === 'walk' || w.zones.some(z => ((z.layer === 'keepclear' && (z.kind === 'path' || z.kind === 'link')) || OPEN_PAVED.has(z.kind)) && inRect(z.rect, px, py));
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
        const open: [number, number, number, number, number][] = [[0, sx, sy, 1, 0]];   // cost, x, y, heading (1 = down), cost without the hidden penalty
        dist.set(key(sx, sy, 1), 0);
        const DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]];
        let found = -1;
        while (open.length) {
          open.sort((a, b) => a[0] - b[0]);
          const [cost, x, y, h, base] = open.shift()!;
          if (cost > (dist.get(key(x, y, h)) ?? Infinity) || base > r.depth * 3) continue;
          if (goal(x, y)) { found = key(x, y, h); break; }
          for (const [hi, [dx, dy]] of DIRS.entries()) {
            const nx = x + dx, ny = y + dy;
            if (!goal(nx, ny) && !pass(nx, ny)) continue;
            // exp-07: a walk one cannot see is worth little: under upper floors only where there is no other way (865057 L3:
            // the door's walk ran down under the blue building, a stub into a wall to the eye)
            // (the penalty does not count against the route's length limit)
            const under = cx.seenWalks && w.covers.some(q => inRect(q, nx * T + 8, ny * T + 8)) ? 1.5 : 0;
            const step = 1 + (hi !== h ? 0.5 : 0) + (goal(nx, ny) ? 0 : (w.lawn(nx * T + 8, ny * T + 8) ? 1 : 0) + occupants(nx, ny).length * 4);
            const c2 = cost + step + under;
            const k2 = key(nx, ny, hi);
            if (c2 < (dist.get(k2) ?? Infinity)) { dist.set(k2, c2); prev.set(k2, key(x, y, h)); open.push([c2, nx, ny, hi, base + step]); }
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
          // it turns there into its continuation (exp-07)
          if (w.zones.some(q => q.kind === 'link' && q.gid === z.gid && rectGap(q.rect, endRect) <= 2)) continue;
          V(`${z.id}/${dir < 0 ? 'start' : 'end'}`, [], endRect, `花园小路（${z.gid}）一头直接撞上楼的墙，不通向任何地方`);
        }
      }
      break;
    }
    case 'dead-end': {
      out.push(...deadEnds(c, cx, r.reach));
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
        // exp-06: one garden may have several paths (its halves'): the half under this path, the users of this path
        const garden = w.zones.find(q => q.layer === 'yard' && q.gid === z.gid && rectsOverlap(q.rect, z.rect));
        const lawnR = garden ? { x0: Math.max(garden.rect.x0, Math.floor(z.rect.x0 / T) * T), y0: Math.max(garden.rect.y0, Math.floor(z.rect.y0 / T) * T), x1: Math.min(garden.rect.x1, Math.ceil(z.rect.x1 / T) * T), y1: Math.min(garden.rect.y1, Math.ceil(z.rect.y1 / T) * T) } : z.rect;
        const users = w.objs.filter(o => o.anchor?.ref === `${z.gid}/path` && inRect(grow(z.rect, 2), o.anchor.x, o.anchor.y));
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
    case 'dead-end': return w.zones.filter(z => (z.layer === 'keepclear' && z.kind === 'path') || (z.layer === 'block' && z.kind === 'alley')).length;
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

// ------------------------------------------------------------------------------------------------
// C25 (exp-07): dead-end paths and alleys, continued where a few cells reach somewhere walkable, else cut back to a
// junction, else turned into lawn

type Cell = [number, number];
const ck = (x: number, y: number) => `${x},${y}`;
/** paved spaces with a purpose, places a way may lead to even under upper floors */
const DEST = new Set(['parking', 'driveway', 'plaza', 'forecourt', 'passage', 'service', 'pocket', 'island', 'alley']);

/** an end of a way: its end cells, the outward direction; a path's: the index of its end cell */
interface End { cells: Cell[]; d: Cell; idx?: number }
/** a way that may lead nowhere: a garden path (cells in order along its axis) or an alley */
interface Way {
  z: ZoneRec; alley: boolean; own: Set<string>; cells: Cell[]; ends: End[];
  /** a path: its axis; the first / last cell not under a building's upper floors (-1: all hidden) */
  horiz?: boolean; vis?: [number, number];
  /** an alley: its axis, its kept-clear corridor */
  vert?: boolean; corridor?: PxRect;
}

function deadEnds(c: Constraint, cx: Ctx, reach: number): Violation[] {
  const { w, g } = cx;
  const out: Violation[] = [];
  const GW = Math.ceil(w.W / T), GH = Math.ceil(w.H / T), S = T / G;
  const DIRS: Cell[] = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  const inMap = (x: number, y: number) => x >= 0 && y >= 0 && x < GW && y < GH;
  const px = (x: number, y: number) => [x * T + 8, y * T + 8] as const;
  const hidden = (x: number, y: number) => { const [a, b] = px(x, y); return w.covers.some(q => inRect(q, a, b)); };
  const wall = (x: number, y: number) => { const [a, b] = px(x, y); return w.walls.some(q => inRect(q, a, b)); };
  const lawn = (x: number, y: number) => { const [a, b] = px(x, y); return w.lawn(a, b); };
  const gr = (x: number, y: number) => { const [a, b] = px(x, y); return w.ground(a, b); };
  const rootedCell = (x: number, y: number) => {
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const k = g.comp[(y * S + sy) * g.gw + x * S + sx];
      if (k >= 0 && rooted(g, k)) return true;
    }
    return false;
  };
  // walkable and connected to the street: sidewalk or paving, not lawn, not a footprint. Under a building's upper floors
  // too: a path that runs on under them to the sidewalk is a covered passage (887735 L1, 389673 L1); what may be seen
  // matters only for where a continuation is laid
  // An alley is walkable whatever its own bins (a through alley loses those standing in the way, below)
  const alleys = w.zones.filter(z => z.layer === 'block' && z.kind === 'alley').map(z => z.rect);
  const inAlley = (x: number, y: number) => { const [a, b] = px(x, y); return alleys.some(r => inRect(r, a, b)); };
  const walkGrid = Array.from({ length: GH }, (_, y) => Array.from({ length: GW }, (_, x) =>
    !wall(x, y) && (gr(x, y) === 'walk' || (gr(x, y) === 'lot' && !lawn(x, y))) && (rootedCell(x, y) || inAlley(x, y))));
  const walk = (x: number, y: number) => inMap(x, y) && walkGrid[y][x];
  const seen = (x: number, y: number) => walk(x, y) && !hidden(x, y);
  /** somewhere a way can lead to: walkable ground one sees, a sidewalk (an upper floor may overhang it), an alley or
   *  another purposeful paved space (849873 L1: the path comes out in the parking lot under the upper floors); not the
   *  bare paving under a building's upper floors (290342 L1: a path ending there is a dead end) */
  // ... one that can be seen somewhere (173387 L2, good: a junk corner wholly under upper floors leaves the alley a dead end)
  const seenSomewhere = (r: PxRect) => {
    for (let y = r.y0 + 8; y < r.y1; y += T) for (let x = r.x0 + 8; x < r.x1; x += T) if (!w.covers.some(q => inRect(q, x, y))) return true;
    return false;
  };
  const dests = w.zones.filter(z => (z.layer === 'yard' || z.layer === 'block') && DEST.has(z.kind) && seenSomewhere(z.rect)).map(z => z.rect);
  const inDest = (x: number, y: number) => { const [a, b] = px(x, y); return dests.some(r => inRect(r, a, b)); };
  // and other paths and links, hidden or not: they are the network (17: an exp-06 link under a building meets a path)
  const wayRects = w.zones.filter(z => z.layer === 'keepclear' && (z.kind === 'path' || z.kind === 'link')).map(z => z.rect);
  const onWay = (x: number, y: number) => { const [a, b] = px(x, y); return wayRects.some(r => inRect(r, a, b)); };
  const place = (x: number, y: number) => walk(x, y) && (!hidden(x, y) || gr(x, y) === 'walk' || inAlley(x, y) || inDest(x, y) || onWay(x, y));
  /** the ground a detour is measured over: walkable ground one sees, sidewalks, alleys (not what is under upper floors) */
  const openGround = (x: number, y: number) => walk(x, y) && (!hidden(x, y) || gr(x, y) === 'walk' || inAlley(x, y));
  /** steps over `openGround` from the nearest of `from`, not through `skip` (up to `max`) */
  const walkDist = (from: Cell[], skip: Set<string>, max: number) => {
    const d = new Map<string, number>(from.map(q => [ck(...q), 0]));
    let front = [...from];
    for (let n = 1; n <= max && front.length; n++) {
      const next: Cell[] = [];
      for (const [x, y] of front) for (const [dx, dy] of DIRS) {
        const k = ck(x + dx, y + dy);
        if (d.has(k) || skip.has(k) || !openGround(x + dx, y + dy)) continue;
        d.set(k, n); next.push([x + dx, y + dy]);
      }
      front = next;
    }
    return d;
  };
  const doorAt = (x: number, y: number) => { const [a, b] = px(x, y); return w.doors.some(d => Math.abs(d.x - a) <= 16 && Math.abs(d.y - b) <= 24); };
  const cellR = (x: number, y: number): PxRect => ({ x0: x * T + 3, y0: y * T + 3, x1: x * T + T - 3, y1: y * T + T - 3 });
  // a tree's footprint is its canopy (30 px): a path may pass beside the trunk, under the canopy's edge
  const foot = (o: WObj): PxRect => o.cls === 'tree' ? { ...o.fp!, x0: (o.fp!.x0 + o.fp!.x1) / 2 - 6, x1: (o.fp!.x0 + o.fp!.x1) / 2 + 6 } : o.fp!;
  const occupants = (x: number, y: number) => w.objs.filter(o => o.fp && o.cls !== 'manhole' && rectsOverlap(foot(o), cellR(x, y)));
  // what a new stretch may clear away: pot plants and bushes, litter, people (never trees, benches, bins, fences)
  const movable = (o: WObj) => o.person || o.cls === 'plant' || (o.cls === 'trash' && !new RegExp(BINS).test(o.key));
  const cellRect = ([x, y]: Cell): PxRect => ({ x0: x * T, y0: y * T, x1: x * T + T, y1: y * T + T });
  const NAMES: Record<string, string> = { path: '别的小路', link: '别的小路', parking: '停车场', plaza: '广场', forecourt: '楼前空地', passage: '楼间过道', alley: '巷子', service: '杂物角', pocket: '街角空地', island: '小岛' };
  const placeName = (x: number, y: number) => {
    if (gr(x, y) === 'walk') return '人行道';
    const [a, b] = px(x, y);
    const z = w.zones.find(q => q.layer === 'keepclear' && (q.kind === 'path' || q.kind === 'link') && inRect(q.rect, a, b))
      ?? w.zones.find(q => (q.layer === 'yard' || q.layer === 'block') && inRect(q.rect, a, b));
    return (z && NAMES[z.kind]) ?? '铺地';
  };

  // the ways: garden paths (and their links), alleys
  const ways: Way[] = [];
  for (const z of w.zones) {
    if (z.layer === 'keepclear' && z.kind === 'path') {
      const horiz = z.rect.x1 - z.rect.x0 > z.rect.y1 - z.rect.y0;
      const line = horiz ? Math.floor((z.rect.y0 + z.rect.y1) / 2 / T) : Math.floor((z.rect.x0 + z.rect.x1) / 2 / T);
      const a0 = horiz ? Math.floor(z.rect.x0 / T) : Math.floor(z.rect.y0 / T), a1 = horiz ? Math.ceil(z.rect.x1 / T) - 1 : Math.ceil(z.rect.y1 / T) - 1;
      const cells: Cell[] = [];
      for (let a = a0; a <= a1; a++) cells.push(horiz ? [a, line] : [line, a]);
      const vis = cells.map(([x, y]) => !hidden(x, y));
      ways.push({ z, alley: false, own: new Set(cells.map(([x, y]) => ck(x, y))), cells, horiz, vis: [vis.indexOf(true), vis.lastIndexOf(true)],
        ends: [{ cells: [cells[0]], d: horiz ? [-1, 0] : [0, -1], idx: 0 }, { cells: [cells[cells.length - 1]], d: horiz ? [1, 0] : [0, 1], idx: cells.length - 1 }] });
    } else if (z.layer === 'block' && z.kind === 'alley') {
      const cells: Cell[] = [];
      for (let y = Math.floor(z.rect.y0 / T); y < Math.ceil(z.rect.y1 / T); y++) for (let x = Math.floor(z.rect.x0 / T); x < Math.ceil(z.rect.x1 / T); x++) cells.push([x, y]);
      if (cells.some(([x, y]) => lawn(x, y))) continue;   // already downgraded to lawn
      const xs = cells.map(q => q[0]), ys = cells.map(q => q[1]);
      const X0 = Math.min(...xs), X1 = Math.max(...xs), Y0 = Math.min(...ys), Y1 = Math.max(...ys);
      const vert = Y1 - Y0 >= X1 - X0;
      const own = new Set(cells.map(([x, y]) => ck(x, y)));
      // a door on it, or an opening in its sides onto somewhere (not the sidewalk it starts from): it leads somewhere,
      // no dead end (it stays listed: its bins may stand in the way through)
      const side = cells.flatMap(([x, y]) => (vert ? [[x - 1, y], [x + 1, y]] : [[x, y - 1], [x, y + 1]]) as Cell[]).filter(([x, y]) => !own.has(ck(x, y)));
      const through = w.doors.some(d => inRect(grow(z.rect, 8), d.x, d.y)) || side.some(([x, y]) => gr(x, y) !== 'walk' && place(x, y));
      // its ends, but one on the carriageway or off the map
      const row = (k: number): Cell[] => cells.filter(q => (vert ? q[1] : q[0]) === k);
      const ends = through ? [] : ([[vert ? Y0 : X0, -1], [vert ? Y1 : X1, 1]] as const).map(([k, sg]) => ({ cells: row(k), d: (vert ? [0, sg] : [sg, 0]) as Cell }))
        .filter(e => !e.cells.some(([x, y]) => ['road', 'none'].includes(gr(x + e.d[0], y + e.d[1]))));
      const corridor = w.zones.find(q => q.layer === 'keepclear' && q.kind === 'alley' && q.gid === z.gid)?.rect;
      ways.push({ z, alley: true, own, cells, ends, corridor, vert });
    }
  }

  // its continuation, once made (the graph may still count the trunk's canopy as in the way)
  const linkAt = (s: Way) => {
    const links = w.zones.filter(q => q.layer === 'keepclear' && q.kind === 'link' && q.gid === s.z.gid);
    return (x: number, y: number) => { const [a, b] = px(x, y); return links.some(q => inRect(q.rect, a, b)); };
  };
  /** the way gets somewhere through cell (x, y): the map edge, walkable ground, a door, its own continuation */
  const opens = (s: Way, own: (x: number, y: number) => boolean, x: number, y: number) =>
    !s.own.has(ck(x, y)) && (!inMap(x, y) || place(x, y) || (wall(x, y) && doorAt(x, y)) || own(x, y));
  /** a path's cells beside it (across its axis) */
  const sidesOf = (s: Way, q: Cell): Cell[] => s.horiz ? [[q[0], q[1] - 1], [q[0], q[1] + 1]] : [[q[0] - 1, q[1]], [q[0] + 1, q[1]]];
  const ahead = (e: End, [x, y]: Cell): Cell[] => [[x + e.d[0], y + e.d[1]], [x + e.d[1], y + e.d[0]], [x - e.d[1], y - e.d[0]]];
  const deadOf = (s: Way) => {
    const own = linkAt(s), n = s.cells.length;
    return s.ends.filter(e => !e.cells.some(q => ahead(e, q).some(([x, y]) => opens(s, own, x, y)))
      // a one-cell nub past a junction is a bench nook, not a way to anywhere (791885 L2, good: 热闹不空)
      && !(!s.alley && n >= 3 && sidesOf(s, s.cells[e.idx === 0 ? 1 : n - 2]).some(([x, y]) => opens(s, own, x, y))));
  };
  /** the benches facing a garden path and the people walking on it (anchored on `<gid>/path` at this path: a joined garden has two) */
  const pathUsers = (s: Way) => w.objs.filter(o => o.anchor?.ref === `${s.z.gid}/path` && inRect(grow(s.z.rect, 2), o.anchor.x, o.anchor.y));
  /** the path cell a user stands beside (its foot projected onto the path's axis) */
  const nearestCell = (s: Way, o: WObj): Cell => {
    const a = Math.floor((s.horiz ? o.fx : o.fy) / T), at = (q: Cell) => Math.abs((s.horiz ? q[0] : q[1]) - a);
    return s.cells.reduce((best, q) => at(q) < at(best) ? q : best);
  };
  const deadAll = new Map(ways.map(s => [s, deadOf(s)] as const));
  // two dead ends do not make a way by meeting each other (two stubs off the same sidewalk, joined into a loop)
  const deadCells = new Set([...deadAll].filter(([, d]) => d.length).flatMap(([s]) => [...s.own]));

  /** an alley's own bins standing in its way through: its kept-clear corridor and the cells past it to its inner end */
  const inTheWay = (s: Way, inner: Cell[]) => s.corridor ? gidMembers(cx, s.z.gid).filter(o => o.fp && !o.person && new RegExp(BINS).test(o.key)
    && [s.corridor!, ...inner.map(q => cellR(...q))].some(r => rectsOverlap(o.fp!, r))) : [];
  for (const s of ways) {
    const dead = deadAll.get(s)!;
    if (s.alley && !dead.length && s.corridor) {
      // it leads somewhere: its way through runs from the street to its farthest opening (a side onto somewhere, a door,
      // the far end); the bins standing in its corridor on that stretch go (865057 L1: the dumpster across the alley,
      // 挡路), those in the nook past the last opening stay
      const cr = s.corridor, ax = (q: Cell) => s.vert ? q[1] : q[0];
      const ks = s.cells.map(ax), lo = Math.min(...ks), hi = Math.max(...ks);
      const off = (q: Cell, k: number): Cell => s.vert ? [q[0], q[1] + k] : [q[0] + k, q[1]];
      const across = (q: Cell): Cell[] => s.vert ? [[q[0] - 1, q[1]], [q[0] + 1, q[1]]] : [[q[0], q[1] - 1], [q[0], q[1] + 1]];
      const street = s.cells.some(q => ax(q) === lo && gr(...off(q, -1)) === 'walk') ? lo : hi, far = street === lo ? hi : lo;
      const own = linkAt(s), there = (q: Cell) => !s.own.has(ck(...q)) && gr(...q) !== 'walk' && (place(...q) || own(...q));
      const openAt = [
        ...s.cells.filter(q => across(q).some(there)).map(ax),
        ...w.doors.filter(d => inRect(grow(s.z.rect, 8), d.x, d.y)).map(d => Math.min(hi, Math.max(lo, Math.floor((s.vert ? d.y - 1 : d.x) / T)))),
        ...(s.cells.some(q => ax(q) === far && there(off(q, far === lo ? -1 : 1))) ? [far] : [])];
      if (openAt.length) {
        const to = street === lo ? Math.max(...openAt) : Math.min(...openAt), k0 = Math.min(street, to), k1 = Math.max(street, to);
        const lane: PxRect = s.vert ? { x0: cr.x0, x1: cr.x1, y0: k0 * T, y1: (k1 + 1) * T } : { x0: k0 * T, x1: (k1 + 1) * T, y0: cr.y0, y1: cr.y1 };
        const bins = gidMembers(cx, s.z.gid).filter(o => o.fp && !o.person && new RegExp(BINS).test(o.key) && rectsOverlap(o.fp, lane));
        if (bins.length) out.push({ c: c.id, target: `${s.z.id}/through`, objs: bins.map(o => o.id), rect: union(bins.map(o => o.fp!)),
          msg: `巷子（${s.z.gid ?? s.z.id}）通到里面：挡在通道上的 ${bins.map(o => o.key.split('/').pop()).join('、')} 删掉` });
      }
    }
    if (!dead.length) continue;
    const own = linkAt(s), n = s.cells.length;
    // a path's junctions: cells something joins from the side (a door's path, a link, another path)
    const junction = s.alley ? [] : s.cells.map(q => sidesOf(s, q).some(([x, y]) => opens(s, own, x, y)));
    // where the way already gets to: a continuation must arrive somewhere else
    const reached: Cell[] = [
      ...s.ends.filter(e => !dead.includes(e)).flatMap(e => e.cells.flatMap(q => ahead(e, q).filter(([x, y]) => !s.own.has(ck(x, y)) && place(x, y)))),
      ...(s.alley ? [] : s.cells.flatMap(q => sidesOf(s, q).filter(([x, y]) => !s.own.has(ck(x, y)) && place(x, y))))];
    const what = s.alley ? `巷子（${s.z.gid ?? s.z.id}）` : `花园小路（${s.z.gid}）`;
    // continue every dead end: Dijkstra over (cell, heading) from its end cells, through lot cells that are not
    // footprints and not blocked by anything that must stay; the goal is a walkable cell. From the end one can see,
    // in the open (464294: the path runs on under the red building into a wall; it is continued where it goes under,
    // the stretch under the building goes). Not under upper floors: nobody sees such a link (865057 L3, good: the path
    // that would have gone under the blue building is better deleted), unless the path itself is all under them. With both ends dead, the second continuation must arrive
    // somewhere else (>= 6 cells from the first); nor may a continuation run back to where the way already gets to.
    // And it must be a shortcut: walking from where the way gets to (the other continuation's end) to the goal without
    // it takes over 1.5 x the walk through it, else it adds nothing (a stub joined to the door path next to it, an
    // alley joined to a garden path that runs to the same sidewalk)
    const taken = new Set<string>(), goals: Cell[] = [...reached];
    type Route = { cells: Cell[]; goal: Cell; from: Cell; blockers: WObj[]; under: Cell[]; wide: Cell[] };
    const routes = new Map<End, Route>();
    const search = (starts: Cell[], d: Cell, open: boolean, len: number): Omit<Route, 'under' | 'blockers' | 'wide'> | null => {
      const ok = open ? seen : place;
      const key = (x: number, y: number, h: number) => (y * GW + x) * 4 + h;
      const dist = new Map<number, number>(), prev = new Map<number, number>(), steps = new Map<number, number>();
      const q: [number, number, number, number, boolean][] = [];   // cost, x, y, heading, goal
      const h0 = DIRS.findIndex(([dx, dy]) => dx === d[0] && dy === d[1]);
      for (const [x, y] of starts) { dist.set(key(x, y, h0), 0); steps.set(key(x, y, h0), 0); q.push([0, x, y, h0, false]); }
      const far = (x: number, y: number) => goals.every(([gx, gy]) => Math.abs(gx - x) + Math.abs(gy - y) >= 6);
      const around = goals.length ? walkDist(goals, s.own, 3 * (len + reach)) : null;
      const shortcut = (x: number, y: number, k: number) => !around || (around.get(ck(x, y)) ?? Infinity) > 1.5 * (len + k);
      let found = -1;
      while (q.length) {
        q.sort((a, b) => a[0] - b[0]);
        const [cost, x, y, h, isGoal] = q.shift()!;
        const k = key(x, y, h);
        if (cost > (dist.get(k) ?? Infinity)) continue;
        if (isGoal) { found = k; break; }
        const m = steps.get(k)!;
        for (const [hi, [dx, dy]] of DIRS.entries()) {
          const nx = x + dx, ny = y + dy;
          if (!inMap(nx, ny) || s.own.has(ck(nx, ny)) || taken.has(ck(nx, ny)) || deadCells.has(ck(nx, ny))) continue;
          const goal = ok(nx, ny);
          if (goal && (!far(nx, ny) || !shortcut(nx, ny, m))) continue;
          if (!goal) {
            if (m + 1 > reach || gr(nx, ny) !== 'lot' || wall(nx, ny) || (open && hidden(nx, ny))) continue;
            if (occupants(nx, ny).some(o => !movable(o))) continue;
            // no hairpin: past its first cell it does not run back beside its own way (329528 L1, bad: the link wound
            // back down the little garden next to its path)
            if (m >= 1 && DIRS.some(([ax, ay]) => s.own.has(ck(nx + ax, ny + ay)))) continue;
          }
          const c2 = cost + 1 + (hi !== h ? 0.5 : 0) + (goal ? 0 : occupants(nx, ny).length * 3);
          const k2 = key(nx, ny, hi);
          if (c2 < (dist.get(k2) ?? Infinity)) { dist.set(k2, c2); prev.set(k2, k); steps.set(k2, m + 1); q.push([c2, nx, ny, hi, goal]); }
        }
      }
      if (found < 0) return null;
      const gc = Math.floor(found / 4), goal: Cell = [gc % GW, Math.floor(gc / GW)];
      const cells: Cell[] = [];
      let from: Cell = goal;
      for (let k2 = prev.get(found); k2 !== undefined; k2 = prev.get(k2)) {
        const c0 = Math.floor(k2 / 4), cell: Cell = [c0 % GW, Math.floor(c0 / GW)];
        if (s.own.has(ck(...cell))) { from = cell; break; }
        cells.unshift(cell);
      }
      return { cells, goal, from };
    };
    // a way with another way running beside it (within 2 cells) along most of it adds nothing by going on: it is not
    // continued (254889 L2, good: the alley next to the garden path is meaningless; 447731 L2, bad: the garden path next
    // to the alley, "where there is an alley, its way comes first"). Beside the sidewalk is C20's
    const across = s.alley ? !s.vert : !!s.horiz;   // the way runs left to right: look above and below
    const beside = s.cells.filter(([x, y]) => [-2, -1, 1, 2].some(k => {
      const [nx, ny] = across ? [x, y + k] : [x + k, y];
      return !s.own.has(ck(nx, ny)) && !own(nx, ny) && gr(nx, ny) !== 'walk' && place(nx, ny);
    })).length >= 0.7 * s.cells.length;
    for (const e of beside ? [] : dead) {
      const tries: { starts: Cell[]; open: boolean; under: Cell[] }[] = [];
      if (s.alley) {
        const inCorridor = ([x]: Cell) => !s.corridor || (x * T + 8 >= s.corridor.x0 && x * T + 8 < s.corridor.x1);
        tries.push({ starts: e.cells.some(inCorridor) ? e.cells.filter(inCorridor) : e.cells, open: true, under: [] });
      } else {
        // the end one can see: past it, the path's cells up to the real end are hidden
        const v = e.idx === 0 ? s.vis![0] : s.vis![1];
        if (v >= 0) tries.push({ starts: [s.cells[v]], open: true, under: e.idx === 0 ? s.cells.slice(0, v) : s.cells.slice(v + 1) });
        // one wholly under upper floors: under them too (849873 L1: one lawn cell short of the parking lot)
        else tries.push({ starts: e.cells, open: false, under: [] });
      }
      for (const t of tries) {
        const len = n - t.under.length;
        const r = search(t.starts, e.d, t.open, len);
        if (!r) continue;
        for (const q of r.cells) taken.add(ck(...q));
        goals.push(r.goal);
        // an alley's continuation is as wide as the alley where it runs straight on (447731 L1, good, but: the strip of
        // lawn left beside the link should go too)
        const wide: Cell[] = [];
        if (s.alley) {
          let k = 0;
          while (k < r.cells.length && r.cells[k][0] === r.from[0] + e.d[0] * (k + 1) && r.cells[k][1] === r.from[1] + e.d[1] * (k + 1)) k++;
          for (const sc of e.cells) {
            if (sc[0] === r.from[0] && sc[1] === r.from[1]) continue;
            for (let i = 1; i <= k; i++) {
              const q: Cell = [sc[0] + e.d[0] * i, sc[1] + e.d[1] * i];
              if (s.own.has(ck(...q)) || taken.has(ck(...q)) || place(...q)) break;
              if (gr(...q) !== 'lot' || wall(...q) || hidden(...q) || occupants(...q).some(o => !movable(o))) break;
              wide.push(q); taken.add(ck(...q));
            }
          }
        }
        routes.set(e, { ...r, under: t.under, wide, blockers: [...new Set([...r.cells, ...wide].flatMap(q => occupants(...q)))] });
        break;
      }
    }

    // a path end that cannot be continued is cut back to the nearest junction; the path stays only if what is left
    // joins at least two things (a live end, a continuation, a junction), else all of it goes
    let keep: [number, number] | null = null;
    if (!s.alley) {
      let a = 0, b = n - 1;
      for (const e of dead) {
        const rt = routes.get(e);
        if (rt) {   // continued from the end one can see: the hidden cells past it go
          if (e.idx === 0) a = Math.max(a, rt.under.length); else b = Math.min(b, n - 1 - rt.under.length);
          continue;
        }
        const j = e.idx === 0 ? junction.indexOf(true) : junction.lastIndexOf(true);
        if (j < 0) { a = b + 1; break; }
        if (e.idx === 0) a = Math.max(a, j); else b = Math.min(b, j);
      }
      const joins = s.ends.filter(e => !dead.includes(e) || routes.has(e)).length + junction.filter((jn, i) => jn && i >= a && i <= b).length;
      keep = a <= b && joins >= 2 ? [a, b] : null;
    }
    const continued = s.alley ? routes.size === dead.length : keep !== null;

    if (continued) {
      // continued: pave the new stretches in the way's own paving, lift their lawn, clear what stood on them
      const addZones: Omit<ZoneRec, 'id'>[] = [];
      const objs = new Set<string>([...routes.values()].flatMap(rt => rt.blockers.map(o => o.id)));
      const pave: NonNullable<Violation['pave']> = [];
      const where: string[] = [];
      for (const rt of routes.values()) {
        // an alley's dead end becomes a way through: its cells between the kept-clear corridor and the end are cleared,
        // and its own bins standing in the way go (865057 L1: the dumpster across the alley)
        const inner: Cell[] = s.alley && s.corridor ? s.cells.filter(([x, y]) => (s.vert ? x === rt.from[0] : y === rt.from[1]) && !inRect(s.corridor!, x * T + 8, y * T + 8)) : [];
        for (const q of inner) for (const o of occupants(...q)) objs.add(o.id);
        if (s.alley) for (const o of inTheWay(s, inner)) objs.add(o.id);
        for (const q of rt.cells) pave.push({ cell: q, src: rt.from });
        for (const q of rt.wide) pave.push({ cell: q, src: s.vert ? [q[0], rt.from[1]] : [rt.from[0], q[1]] });
        if (rt.wide.length) addZones.push({ layer: 'keepclear', kind: 'link', rect: union(rt.wide.map(cellRect)),
          reason: `断头路接上（exp-07）：${what}的接线和巷子一样宽`, gid: s.z.gid, exp: c.exp });
        const name = placeName(...rt.goal);
        where.push(`往前接 ${rt.cells.length} 格到${name}`);
        // one keep-clear zone per straight stretch, from the alley's inner cells (if any) on
        const dd = (q: Cell) => Math.abs(q[0] - rt.from[0]) + Math.abs(q[1] - rt.from[1]);
        const line = [...inner.sort((p, q) => dd(q) - dd(p)), ...rt.cells];
        for (let i = 0; i < line.length;) {
          const hz = i + 1 < line.length && line[i + 1][1] === line[i][1];
          let j = i + 1;
          while (j < line.length && (hz ? line[j][1] === line[i][1] : line[j][0] === line[i][0])) j++;
          const seg = union(line.slice(i, j).map(cellRect));
          addZones.push({ layer: 'keepclear', kind: 'link', rect: hz ? { ...seg, y0: seg.y0 + 2, y1: seg.y1 - 2 } : { ...seg, x0: seg.x0 + 2, x1: seg.x1 - 2 },
            reason: `断头路接上（exp-07）：${what}的一头不通向任何地方，往前接 ${rt.cells.length} 格到${name}`, gid: s.z.gid, exp: c.exp });
          i = j;
        }
      }
      // what of a path goes: past a continuation laid where it goes under upper floors, the hidden rest; past a
      // junction, the stub that could not be continued
      const under = [...routes.values()].reduce((m, rt) => m + rt.under.length, 0);
      const gone: Cell[] = keep ? s.cells.filter((_, i) => i < keep![0] || i > keep![1]) : [];
      const cut = gone.length - under;
      if (cut > 0) where.push(`接不上的一头剪到岔口（${cut} 格改成草坪）`);
      if (under) where.push(`伸进楼底下的 ${under} 格改成草坪`);
      const rect = union([...[...routes.values()].flatMap(rt => [...rt.cells, rt.from]), ...gone].map(cellRect));
      const v: Violation = { c: c.id, target: s.z.id, objs: [], rect, msg: `${what}${dead.length > 1 ? '两头都' : '一头'}不通向任何地方：${where.join('；')}` };
      if (pave.length) { v.pave = pave; v.clearLawn = [...routes.values()].flatMap(rt => [...rt.cells, ...rt.wide].map(cellRect)); }
      if (gone.length) {
        const goneSet = new Set(gone.map(q => ck(...q)));
        const r0 = union(s.cells.filter(q => !goneSet.has(ck(...q))).map(cellRect));
        v.toLawn = gone.map(cellRect);
        v.dropZones = [s.z.id];
        addZones.unshift({ layer: s.z.layer, kind: s.z.kind, rect: s.horiz ? { ...r0, y0: s.z.rect.y0, y1: s.z.rect.y1 } : { ...r0, x0: s.z.rect.x0, x1: s.z.rect.x1 },
          reason: `${s.z.reason}（${cut > 0 ? '接不上的一头剪掉' : '伸进楼的高层底下、通不到哪里的一段改成草坪'}，exp-07）`, gid: s.z.gid, exp: s.z.exp, stream: s.z.stream });
        // the benches facing the stretch that goes, the people walking on it
        for (const o of pathUsers(s)) if (goneSet.has(ck(...nearestCell(s, o)))) objs.add(o.id);
      }
      v.objs = [...objs];
      if (addZones.length) v.addZones = addZones;
      out.push(v);
    } else if (s.alley) {
      out.push({ c: c.id, target: s.z.id, objs: gidMembers(cx, s.z.gid).map(o => o.id), zone: s.z.id, rect: s.z.rect,
        msg: `${what}尽头不通向任何地方，${reach} 格内接不到新的去处：改成草坪（连同巷子里的东西）` });
    } else {
      // like C20: the path becomes lawn, the benches facing it and the people on it go
      const users = pathUsers(s);
      out.push({ c: c.id, target: s.z.id, objs: users.map(o => o.id), rect: s.z.rect, toLawn: s.cells.map(cellRect), dropZones: [s.z.id],
        msg: `${what}${dead.length > 1 ? '两头都' : '一头'}不通向任何地方，${reach} 格内接不到新的去处，也没有岔口：改成草坪${users.length ? `（连同面朝它的 ${users.map(o => o.key.split('/').pop()).join('、')}）` : ''}` });
    }
  }
  return out;
}
