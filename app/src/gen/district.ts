// exp-08 特色街区 (special districts): the main block is the campus of one large special building from the packs
// (school, hospital, police station, fire station, mall, hotel). The landmark's footprint sits on the lot's north edge
// (as exp-03: its upper floors may hang over the north street); everything south of / beside it belongs to it: the school's
// playground, the hospital's helipad, ambulance bay and convenience store, the police car park, the fire engine apron, the
// mall's plaza with billboards and underground car park, the hotel's forecourt and underground car park. No ordinary
// buildings are packed (user 2026-11-07: 普通建筑的生成应该最小化); the block is sized to the campus, the few cells left
// over become ordinary yard (gardens, strips).
// Chosen in the viewer's menu (option `district`, URL d=); absent = 普通街区, the generator as before.
// Sizes, doors and props were read off the sprites and the reference maps school / hostpital_HQ / police_station_HQ /
// shopping_centre_* / hotel (docs/reports/v0.7.7.md).
import { Rng } from './rng';
import { spr, variants, hasSprite } from './assets';
import { slab, asphalt, paintWalkCell, type Layout } from './layout';
import { modularStack, type BuildingPlan } from './buildings';
import type { PlacedBuilding } from './block';
import { SceneBuilder, rect } from './place';
import { person } from './vignettes';
import { TILE } from './types';

const T = TILE;
const C = '3_City_Props/';
const V = '10_Vehicles/';
const SC = '13_School/';
const PS = '15_Police_Station/';
export const EXP08 = 'exp-08';

export type DistrictKind = 'school' | 'hospital' | 'police' | 'fire' | 'mall' | 'hotel';

interface Spec {
  name: string;
  /** sprite variants of the landmark (same size) */
  keys: string[];
  /** door centres (px from the sprite's left edge) on its bottom edge: where people go in */
  doors: number[];
}

export const DISTRICTS: Record<DistrictKind, Spec> = {
  school: { name: '学校', keys: [SC + 'School_1'], doors: [144, 240] },
  hospital: { name: '医院', keys: ['12_Hotel_and_Hospital/Hospital_1'], doors: [64] },
  police: { name: '警察局', keys: [PS + 'Police_Station_1', PS + 'Police_Station_2', PS + 'Police_Station_3'], doors: [52, 176] },
  fire: { name: '消防站', keys: ['18_Fire_Station/Building'], doors: [48] },
  mall: { name: '购物中心', keys: ['9_Shopping_Center_and_Markets/Mall_1'], doors: [140, 237] },
  hotel: { name: '酒店', keys: ['12_Hotel_and_Hospital/Hotel_1'], doors: [52, 136, 216] },
};
export const DISTRICT_KINDS = Object.keys(DISTRICTS) as DistrictKind[];
export const isDistrict = (d: unknown): d is DistrictKind => typeof d === 'string' && d in DISTRICTS;

let nextId = 0;
export const resetDistrictIds = () => { nextId = 0; };

function plan(key: string, doors: number[], label: string): BuildingPlan {
  const sp = spr(key), h = sp.h / T;
  return { id: `L${nextId++}`, w: sp.w / T, h, foot: Math.max(3, Math.round(h * 0.5)), parts: [{ key, dx: 0, dy: 0, sub: 0, role: 'whole' }],
    doors, front: 'landmark', tall: true, label, exp: EXP08 };
}

/** a purposeful area of the campus (cells, half-open; block-local while planning, map cells once placed) */
export interface Feat {
  kind: 'plaza' | 'court' | 'helipad' | 'parking' | 'ramp' | 'billboard' | 'apron' | 'bay';
  x0: number; y0: number; x1: number; y1: number;
  key?: string;
  why: string;
}

/** the campus: the main block's whole plan */
export interface Campus {
  kind: DistrictKind;
  /** interior size the block must have (cells) */
  W: number; H: number;
  /** landmark first; x = left column, bottom = facade row (block-local while planning) */
  items: { plan: BuildingPlan; x: number; bottom: number; side: 'S' | 'N'; why: string }[];
  feats: Feat[];
}

/** the placed campus */
export interface Landmark {
  kind: DistrictKind;
  buildings: PlacedBuilding[];
  feats: Feat[];
  /** every cell the campus takes (feats + building rects on the lot) */
  cells: [number, number][];
}

/** the campus of a district, block-local (decided before the layout: the block is sized to it). Stream `landmark` */
export function planCampus(kind: DistrictKind, rng: Rng): Campus {
  const r = rng.fork('landmark', { district: kind });
  const s = DISTRICTS[kind];
  const main = plan(r.choose('district.variant', { district: kind }, s.keys), s.doors, s.name);
  const lw = main.w, lf = main.foot;
  // the landmark's footprint reaches the lot's north edge (exp-03, user 2026-11-07: 实体底部应该出现在最北边)
  const north = `${s.name}（特色街区 exp-08）：素材里的大型特殊建筑，占地推到地块最北边（楼上层可以伸到北边的街上），南边和旁边整块地都是它的配套设施`;
  const items: Campus['items'] = [];
  const feats: Feat[] = [];
  const side = (label: string) => r.choose(label, { district: kind }, { p: 0.5 });
  let W = lw, H = lf + 4;
  switch (kind) {
    case 'school': {
      // the clock tower beside the school, level with its facade (ref school); a forecourt with the flag pole; a
      // playground (basketball or football court) in front of the forecourt at one end, or beside the school
      let tower: BuildingPlan | null = null, towerLeft = false;
      if (r.choose('district.tower', {}, { p: 0.65 })) {
        tower = plan(r.choose('district.towerModel', {}, [SC + 'Clock_Tower_1', SC + 'Clock_Tower_2']), [], '学校钟楼');
        towerLeft = side('district.towerLeft');
      }
      const core = lw + (tower?.w ?? 0);
      const court = r.choose('district.court', {}, { weights: [...[3, 4, 5, 6].map(i => [`${SC}Basketball_Court_${i}`, 1] as const), ...[1, 2, 7, 8].map(i => [`${SC}Basketball_Court_${i}`, 0.5] as const),
        [`${SC}Soccer_Court_1`, 1], [`${SC}Soccer_Court_2`, 1]] });
      const cw = spr(court).w / T, ch = spr(court).h / T;
      const courtLeft = side('district.courtLeft');
      const front = r.choose('district.courtFront', { cw, ch }, { p: ch <= 13 ? 0.6 : 0.3 });
      let coreX: number, cx: number, cy: number;
      if (front) { W = Math.max(core, cw + 8); H = lf + 4 + ch + 1; coreX = Math.floor((W - core) / 2); cx = courtLeft ? 1 : W - cw - 1; cy = lf + 4; }
      else { W = core + cw + 2; H = Math.max(lf + 5, ch + 2); coreX = courtLeft ? cw + 2 : 0; cx = courtLeft ? 1 : core + 1; cy = 1; }
      const mx = coreX + (tower && towerLeft ? tower.w : 0);
      items.push({ plan: main, x: mx, bottom: lf - 1, side: 'N', why: north });
      if (tower) items.push({ plan: tower, x: towerLeft ? coreX : coreX + lw, bottom: lf - 3, side: 'N', why: '学校的钟楼：参考图 school 里钟楼紧挨着教学楼，和教学楼立面齐平' });
      feats.push({ kind: 'plaza', x0: front ? 0 : coreX, y0: lf, x1: front ? W : coreX + core, y1: H, why: '学校门前的广场：上学放学的人从这里进出，旗杆在台阶旁' });
      feats.push({ kind: 'court', x0: cx, y0: cy, x1: cx + cw, y1: cy + ch, key: court, why: `学校的操场（${court.includes('Soccer') ? '足球场' : '篮球场'}）：${front ? '在门前广场南边的一头' : '在教学楼旁边'}` });
      break;
    }
    case 'hospital': {
      // helipad beside the hospital at the north edge; a convenience store on the street below it; ambulance bay in
      // front of the emergency garages (right wing), entrance forecourt with the sign in front of the main door (left wing)
      const padLeft = side('district.padLeft');
      const pad = `${V}Helicopter_Landing_Pad_1`, pw = spr(pad).w / T, ph = spr(pad).h / T;
      const store = modularStack(r, { floors: r.choose('district.storeFloors', {}, { weights: [[0, 3], [1, 1]] as const }), front: 'retail' });
      store.label = `便利店/${store.label}`;
      W = lw + pw; H = Math.max(lf + 7, ph + store.h);
      const hx = padLeft ? pw : 0, px = padLeft ? 0 : lw;
      items.push({ plan: main, x: hx, bottom: lf - 1, side: 'N', why: north });
      items.push({ plan: store, x: padLeft ? 0 : W - store.w, bottom: H - 1, side: 'S', why: '医院旁的便利店：临街，在停机坪南边，给病人和探视的人买东西' });
      feats.push({ kind: 'helipad', x0: px, y0: 0, x1: px + pw, y1: ph, key: pad, why: '医院的直升机停机坪：在医院旁边、地块最北' });
      feats.push({ kind: 'plaza', x0: hx, y0: lf, x1: hx + 10, y1: H, why: '医院正门前的空地：病人和探视的人从这里进出，临街有医院指示牌' });
      feats.push({ kind: 'apron', x0: hx + 10, y0: lf, x1: hx + lw, y1: H, why: '急诊入口前的救护车坪：救护车从马路开进来，停在急诊卷帘门前' });
      break;
    }
    case 'police': {
      // a large car park (two rows of bays) beside the station, its driveway to the south street behind a barrier;
      // forecourt in front of the station
      const lotLeft = side('district.lotLeft');
      const lotW = 18, lotH = 16;
      W = lw + lotW + 1; H = Math.max(lf + 5, lotH);
      const sx = lotLeft ? lotW + 1 : 0, lx = lotLeft ? 0 : lw + 1;
      items.push({ plan: main, x: sx, bottom: lf - 1, side: 'N', why: north });
      feats.push({ kind: 'plaza', x0: sx, y0: lf, x1: sx + lw, y1: H, why: '警察局门前的空地：来办事的人从这里进出，临街一排隔离桩' });
      feats.push({ kind: 'parking', x0: lx, y0: H - lotH, x1: lx + lotW, y1: H, why: `警察局的大停车场（${lotW}×${lotH} 格，两排车位）：警车和工作人员的车，车道口有道闸（参考图 police_station_HQ）` });
      break;
    }
    case 'fire': {
      // the apron in front of the garages stays clear (its driveway runs out to the street); the engine waits on a bay
      // beside the station, not in front of the garages or the door (user 2026-11-07: 不应该堵住出入口). 2 columns of
      // planting on the east edge keep the driveways clear of the corner crossing (C23)
      const bayLeft = side('district.bayLeft');
      const bw = 10;
      W = lw + bw + 2; H = lf + 6;
      const fx = bayLeft ? bw : 0, bx = bayLeft ? 0 : lw;
      items.push({ plan: main, x: fx, bottom: lf - 1, side: 'N', why: north });
      feats.push({ kind: 'plaza', x0: fx, y0: lf, x1: fx + lw, y1: H, why: '消防站车库前的空地：保持畅通，消防车从车库直接开上马路' });
      feats.push({ kind: 'bay', x0: bx, y0: lf, x1: bx + bw, y1: H, why: '消防车的待命车位：在消防站旁边，不挡车库和入口' });
      break;
    }
    case 'mall': {
      // big plaza in front (ref shopping_centre_*); a band beside the mall with billboards on poles at the north and the
      // underground car park entrance on the street
      const bandLeft = side('district.bandLeft');
      const n = r.int(1, 2);
      const ramp = `${C}Underground_Parking_3`, rw = spr(ramp).w / T, rh = spr(ramp).h / T;
      // the band keeps 3 columns of planting on the outer side: the ramp's driveway stays clear of the corner crossing (C23)
      W = lw + rw + 4; H = Math.max(lf + 7, 6 * n + rh + 1);
      const mx = bandLeft ? rw + 4 : 0, bx = bandLeft ? 3 : lw + 1;
      items.push({ plan: main, x: mx, bottom: lf - 1, side: 'N', why: north });
      feats.push({ kind: 'plaza', x0: mx, y0: lf, x1: mx + lw, y1: H, why: '购物中心门前的大广场：树、花坛、购物车棚、长椅，顾客从街上进来（参考图 shopping_centre_*）' });
      for (let i = 0; i < n; i++) feats.push({ kind: 'billboard', x0: bx + 1, y0: i * 6, x1: bx + 6, y1: i * 6 + 6, why: '购物中心旁立柱上的广告牌（参考图 shopping_centre_with_ads）' });
      feats.push({ kind: 'ramp', x0: bx, y0: H - rh, x1: bx + rw, y1: H, key: ramp, why: '购物中心的地下停车场入口：临街，车从马路直接开进去（参考图 shopping_centre_with_ads）' });
      break;
    }
    case 'hotel': {
      // forecourt in front; the underground car park entrance on the street beside the hotel
      const bandLeft = side('district.bandLeft');
      const ramp = r.choose('district.ramp', {}, [`${C}Underground_Parking_3`, `${C}Underground_Parking_1`, `${C}Underground_Parking_2`]);
      const rw = spr(ramp).w / T, rh = spr(ramp).h / T;
      W = lw + rw + 4; H = Math.max(lf + 4, rh + 2);    // 3 columns of planting outside the ramp (C23), as the mall
      const hx = bandLeft ? rw + 4 : 0, bx = bandLeft ? 3 : lw + 1;
      items.push({ plan: main, x: hx, bottom: lf - 1, side: 'N', why: north });
      feats.push({ kind: 'plaza', x0: hx, y0: lf, x1: hx + lw, y1: H, why: '酒店门前的空地：客人上下车、行李车（参考图 hotel）' });
      feats.push({ kind: 'ramp', x0: bx, y0: H - rh, x1: bx + rw, y1: H, key: ramp, why: '酒店的地下停车场入口：在酒店旁边临街，车从马路直接开进去' });
      break;
    }
  }
  return { kind, W, H, items, feats };
}

/** the campus on the map: the block interior is exactly W x H from (L.bx0, L.by0) */
export function placeCampus(L: Layout, c: Campus): Landmark {
  const ox = L.bx0, oy = L.by0;
  const buildings: PlacedBuilding[] = c.items.map(i => ({ plan: i.plan, cx: ox + i.x, cy: oy + i.bottom - i.plan.h + 1, side: i.side, why: i.why }));
  const feats = c.feats.map(f => ({ ...f, x0: f.x0 + ox, x1: f.x1 + ox, y0: f.y0 + oy, y1: f.y1 + oy }));
  const cells: [number, number][] = [];
  const add = (x0: number, y0: number, x1: number, y1: number) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (L.inP[y]?.[x]) cells.push([x, y]); };
  for (const b of buildings) add(b.cx, b.cy, b.cx + b.plan.w, b.cy + b.plan.h);
  for (const f of feats) add(f.x0, f.y0, f.x1, f.y1);
  return { kind: c.kind, buildings, feats, cells };
}

// ------------------------------------------------------------------------------------------------
// the campus grounds

/** paving and the props of every campus area; everything tagged exp-08 */
export function districtVignettes(L: Layout, lm: Landmark, sb: SceneBuilder, r: Rng) {
  sb.withExp(EXP08, () => grounds(L, lm, sb, r));
}

function grounds(L: Layout, lm: Landmark, sb: SceneBuilder, r0: Rng) {
  const r = sb.enter(r0.fork(lm.kind, { district: lm.kind }));
  const s = DISTRICTS[lm.kind], m = lm.buildings[0], b = m.plan;
  const paving = r.choose('district.paving', {}, ['sidewalk_beige', 'sidewalk_lightbeige', 'sidewalk_lightgrey', 'sidewalk_grey'].filter(st => st !== L.mainStyle));
  // the whole campus, under the buildings too: their sprites have open ground in them (hospital porch, school steps)
  for (const [c, y] of lm.cells) L.base[y][c] = slab(paving, c, y);
  const bx0 = m.cx * T, bx1 = (m.cx + b.w) * T, facade = (m.cy + b.h) * T;
  const doorX = b.doors.map(d => bx0 + d);
  for (const f of lm.feats) {
    const x0 = f.x0 * T, x1 = f.x1 * T, y0 = f.y0 * T, y1 = f.y1 * T;
    const gid = sb.group(f.kind === 'plaza' ? 'landmark' : `landmark-${f.kind}`, f.why, { anchor: { kind: 'building', ref: b.id, x: (x0 + x1) / 2, y: y0 } });
    // plaza / parking: the constraints treat them as such (reachable, ...); the rest are kinds of their own that no
    // constraint asks to be walkable (the helipad and the ramp are solid)
    const zoneKind = f.kind === 'apron' || f.kind === 'bay' ? 'plaza' : f.kind;
    sb.zone(zoneKind === 'plaza' ? 'block' : 'yard', zoneKind, rect(x0, y0, x1, y1), `${f.why}（${f.x1 - f.x0}×${f.y1 - f.y0} 格）`, gid);
    const put = (key: string, fx: number, fy: number, cls: string, why: string, o: { ignoreClear?: boolean | string[]; occupy?: boolean; depth?: number } = {}) =>
      hasSprite(key) ? sb.putFoot(key, fx, fy, cls, { gid, why, depth: 9, ...o }) : null;
    const people = (n: number, role: string, why: string, o: { kid?: number; xa?: number; xb?: number; ya?: number; yb?: number } = {}) => {
      for (let i = 0, k = 0; i < 3 * n && k < n; i++) {
        const kid = o.kid !== undefined && r.choose('district.kid', { district: lm.kind }, { p: o.kid });
        if (person(sb, r, r.int((o.xa ?? x0) + 8, (o.xb ?? x1) - 8), r.int((o.ya ?? y0) + 14, (o.yb ?? y1) - 2), r.choose('district.pose', {}, ['stand', 'stand', 'walk', 'phone'] as const),
          r.choose('district.dir', {}, ['down', 'left', 'right', 'up'] as const), role, gid, why, kid)) k++;
      }
    };
    // flat ground pieces (courts) lie under everything: drawn first, nothing stands "on" them in the footprint sense
    const flat = (key: string, x: number, y: number, why: string) => sb.putAt(key, x, y, 'court', { gid, why, occupy: false, force: true, foot: y });
    const curbY = y1 - 4, facadeY = facade + 10;
    switch (f.kind) {
      case 'court': {
        flat(f.key!, x0, y0, f.why);
        const soccer = f.key!.includes('Soccer');
        put(r.choose('district.ball', {}, soccer ? variants(SC + 'Soccer_Ball') : variants(SC + 'Basketball_Ball')), r.int(x0 + 3 * T, x1 - 3 * T), r.int(y0 + 3 * T, y1 - 2 * T), 'ball', '操场上的球', { occupy: false, ignoreClear: true });
        people(r.int(3, 6), 'citizen', soccer ? '在足球场上踢球的学生' : '在篮球场上打球的学生', { kid: 0.85 });
        break;
      }
      case 'helipad': {
        // the pad is a raised platform with stairs: solid; the helicopter stands on it
        const pad = sb.putAt(f.key!, x0, y0, 'utility', { gid, why: f.why, depth: spr(f.key!).bb[3], force: true });
        if (pad && r.choose('district.helicopter', {}, { p: 0.7 })) {
          const hk = r.choose('district.helicopterModel', {}, [`${V}Helicopter_1`, `${V}Helicopter_2`]), hs = spr(hk);
          sb.putAt(hk, Math.round((x0 + x1 - hs.w) / 2), Math.round(y0 + (y1 - y0) * 0.42 - hs.h / 2), 'vehicle', { gid, why: '停在停机坪上的医院直升机', occupy: false, force: true, foot: pad.foot + 1 });
        }
        break;
      }
      case 'parking': carPark(L, sb, r, f, gid); break;
      case 'bay': {
        // fire station: the engine on its bay beside the station, cones at its corners
        const truck = r.choose('district.truck', {}, ['18_Fire_Station/Fire_Truck_Left', '18_Fire_Station/Fire_Truck_Right', '18_Fire_Station/Fire_Truck_Ladder_1_Left', '18_Fire_Station/Fire_Truck_Ladder_1_Right']);
        put(truck, (x0 + x1) / 2, y1 - 2 * T, 'vehicle', '停在待命车位上的消防车（不挡车库和入口）');
        for (let i = 0, n = r.int(0, 2); i < n; i++) put(r.choose('district.cone', {}, ['8_Worksite/Cone_1', '8_Worksite/Cone_2']), i ? x1 - T : x0 + T, y1 - 6, 'utility', '待命车位角上的锥桶');
        break;
      }
      case 'ramp': {
        put(f.key!, (x0 + x1) / 2, y1, 'utility', f.why, { depth: 40, ignoreClear: true });
        const w = f.x1 - f.x0, lane = w >= 7 ? 4 : 2;
        driveway(L, sb, r, f.x0 + Math.floor((w - lane) / 2), lane, f.y1, gid, '地下停车场入口的车道：穿过人行道通到马路，路缘在这里断开');
        break;
      }
      case 'billboard':
        put(r.choose('district.billboard', {}, variants(C + 'Billboard', [2, 3, 4, 5, 6, 7, 8])), (x0 + x1) / 2, y1 - 2, 'info_sign', f.why, { ignoreClear: true });
        break;
      case 'apron': {
        // hospital: ambulances at the emergency garages (cells 18-25 of the sprite), a curb cut to the street
        const amb = r.choose('district.ambulance', {}, [`${V}Ambulance_Left_1`, `${V}Ambulance_Right_1`]);
        for (const ax of [bx0 + 22 * T, bx0 + 20 * T, bx0 + 24 * T]) if (put(amb, ax, facade + 5 * T, 'vehicle', '停在急诊入口（右侧卷帘门）前的救护车')) break;
        if (y1 - facade >= 9 * T && r.choose('district.ambulance2', {}, { p: 0.6 })) put(r.choose('district.ambulance2Model', {}, [`${V}Ambulance_Down_1`, `${V}Ambulance_Up_1`]), x0 + 2 * T, y1 - 4, 'vehicle', '刚开进来的另一辆救护车');
        for (let i = 0, n = r.int(1, 2); i < n; i++) put(r.choose('district.stretcher', {}, variants('12_Hotel_and_Hospital/Stretcher_Injured')), bx0 + r.int(17, 25) * T, facadeY + 4, 'utility', '急诊门口的担架');
        people(r.int(1, 3), 'citizen', '急诊门口的病人和家属', { yb: facade + 6 * T });
        driveway(L, sb, r, Math.min(f.x1 - 3, m.cx + 21), 3, f.y1, gid, '救护车的车道：急诊坪通到马路，路缘在这里断开');
        break;
      }
      case 'plaza': {
        switch (lm.kind) {
          case 'school': {
            const left = r.choose('district.flagLeft', {}, { p: 0.6 });
            put(r.choose('district.flagModel', {}, [SC + 'Flag_1', SC + 'Flag_2']), left ? bx0 + 4 * T : bx1 - 4 * T, facade + 3 * T - 2, 'utility', '学校门前的旗杆（参考图 school：入口台阶旁）');
            for (const sx of [bx0 + 2 * T, bx1 - 2 * T]) if (r.choose('district.bench', {}, { p: 0.7 })) put(r.choose('district.benchModel', {}, variants(SC + 'Bench', [1, 2, 3, 4])), sx, facadeY, 'bench', '靠着教学楼外墙的长椅');
            for (const sx of [x0 + T, x1 - T]) put(r.choose('district.bedModel', {}, variants(C + 'Flower_Bush', [1, 2, 3])), sx, curbY, 'plant', '学校广场临街角上的花坛');
            people(r.int(3, 6), 'citizen', '放学 / 上学的学生（偶尔有家长）', { kid: 0.8, yb: Math.min(y1, facade + 5 * T) });
            break;
          }
          case 'hospital':
            put('12_Hotel_and_Hospital/Hospital_Sign_1', doorX[0] + 3 * T, curbY, 'info_sign', '医院正门旁临街的“HOSPITAL”指示牌（参考图 hostpital_HQ）');
            for (let y = facade + 4 * T; y < y1 - 3 * T; y += 3 * T) put(r.choose('district.hospTree', {}, [C + 'Tree_11', C + 'Tree_13']), x0 + T, y, 'tree', '医院门前空地边上的树');
            people(r.int(2, 4), 'citizen', '医院门口的病人和探视的人');
            break;
          case 'police':
            for (let px = x0 + T; px < x1 - T; px += 2 * T) if (!doorX.some(d => Math.abs(d - px) < 2 * T)) put(r.choose('district.bollard', {}, [PS + 'Sidewalk_Obstacle_1', PS + 'Sidewalk_Obstacle_2']), px, y1 - 1, 'fence', '警察局门前空地临街的一排隔离桩');
            for (let i = 0, n = r.int(1, 2); i < n; i++) put(r.choose('district.policeCar', {}, [PS + 'Police_Car_1', PS + 'Police_Car_2']), bx0 + r.int(9, 16) * T, curbY - T, 'vehicle', '刚回来停在门口的警车');
            people(r.int(2, 3), 'police', '警察局门前的警察');
            people(r.int(0, 2), 'citizen', '来警察局办事的人', { xb: bx0 + 10 * T });
            break;
          case 'fire': {
            put('18_Fire_Station/Fire_Hydrant', doorX[0] - 1.5 * T, curbY, 'utility', '消防站入口旁的消防栓');
            people(r.int(2, 3), 'firefighter', '消防站门前的消防员', { xa: bx0, xb: bx0 + 6 * T });
            driveway(L, sb, r, m.cx + 7, 6, f.y1, gid, '消防车的车道：车库前的空地通到马路，路缘在这里断开');
            break;
          }
          case 'mall': {
            // ref shopping_centre_*: trees in planters beside the entrances, rows of flower planters along both sides,
            // the trolley shelter at one end of the facade, a bench, many shoppers
            put(r.choose('district.carts', {}, ['9_Shopping_Center_and_Markets/Shopping_Carts_1', '9_Shopping_Center_and_Markets/Shopping_Carts_2', '9_Shopping_Center_and_Markets/Shopping_Carts_3']), bx0 + 2.5 * T, facadeY + 3 * T, 'utility', '购物中心门口的购物车棚');
            for (const sx of [x0 + 1.5 * T, x1 - 1.5 * T]) put(r.choose('district.tree', {}, [C + 'Tree_11', C + 'Tree_13']), sx, facadeY + 2 * T, 'tree', '购物中心门口两侧的树（参考图 shopping_centre_with_ads）');
            const bed = r.choose('district.bedModel', {}, variants(C + 'Flower_Bush', [1, 2, 3]));
            for (let y = facade + 5 * T; y < y1 - T; y += 2.5 * T) for (const sx of [x0 + T, x1 - T]) put(bed, sx, y, 'plant', '广场两侧一列花坛（参考图 shopping_centre_with_ads）');
            if (r.choose('district.mallBench', {}, { p: 0.8 })) put(C + 'Bench_2', (doorX[0] + doorX[1]) / 2, curbY, 'bench', '两个入口之间临街的长椅');
            people(Math.round((f.x1 - f.x0) * (f.y1 - f.y0) / 25), 'customer', '在广场上走动、进出购物中心的顾客');
            break;
          }
          case 'hotel': {
            const pot = r.choose('district.pot', {}, variants('17_Garden/Bush_Potted'));
            put(pot, doorX[1] - 2.5 * T, facadeY, 'plant', '酒店正门两侧的盆栽（左）'); put(pot, doorX[1] + 2.5 * T, facadeY, 'plant', '酒店正门两侧的盆栽（右）');
            if (r.choose('district.trolley', {}, { p: 0.8 })) put(r.choose('district.trolleyModel', {}, variants('12_Hotel_and_Hospital/Luggage_Trolley')), doorX[1] + 4 * T, facadeY + 6, 'utility', '酒店门口的行李车');
            for (const sx of [x0 + T, x1 - T]) put(r.choose('district.hotelBed', {}, variants(C + 'Flower_Bush', [1, 2, 3])), sx, curbY, 'plant', '酒店门前空地临街角上的花坛（参考图 hotel）');
            people(r.int(2, 4), 'business', '酒店门口的客人');
            break;
          }
        }
        break;
      }
    }
  }
}

/** a curb cut: sidewalk cells below the campus (from row y) become road, w columns from x */
function driveway(L: Layout, sb: SceneBuilder, r: Rng, x: number, w: number, y: number, gid: string, why: string) {
  const cells: [number, number][] = [];
  for (let c = x; c < x + w; c++) for (let yy = y; L.cls[yy]?.[c] === 'walk'; yy++) cells.push([c, yy]);
  if (!cells.length) return;
  for (const [cx, cy] of cells) { L.cls[cy][cx] = 'road'; L.base[cy][cx] = asphalt(r); }
  for (const [cx, cy] of cells) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (L.cls[cy + dy]?.[cx + dx] === 'walk') paintWalkCell(L, cx + dx, cy + dy);
  const y1 = Math.max(...cells.map(c => c[1])) + 1;
  sb.zone('yard', 'driveway', rect(x * T, y * T, (x + w) * T, y1 * T), why, gid);
  sb.clear(rect(x * T - 6, y * T - 2 * T, (x + w) * T + 6, (y1 + 2) * T + 6), 'drive', '车道和车道口：车要进出，不停车、不放路缘设施', gid);
}

/** police car park: two rows of bays (2_City_Terrains bay pieces, 9 cells = 3 bays), each with its aisle below; the lower
 *  aisle runs out to the street through a barrier */
function carPark(L: Layout, sb: SceneBuilder, r: Rng, f: Feat, gid: string) {
  const w = f.x1 - f.x0, n = Math.floor(w / 9), px0 = f.x0 + Math.floor((w - n * 9) / 2);
  for (let y = f.y0; y < f.y1; y++) for (let x = f.x0; x < f.x1; x++) L.base[y][x] = asphalt(r);
  const rows = [f.y0, f.y0 + 8].filter(y => y + 8 <= f.y1);
  const cars = variants(V + 'Car_Down').filter(k => spr(k).w <= 48 && spr(k).h <= 80);
  for (const by of rows) {
    for (let p = 0; p < n; p++) for (let j = 0; j < 5; j++) for (let i = 0; i < 9; i++) L.base[by + j][px0 + p * 9 + i] = ['city', i, 8 + j];
    sb.clear(rect(f.x0 * T, (by + 5) * T, f.x1 * T, (by + 8) * T), 'aisle', '停车场通道：车进出车位的地方保持畅通', gid);
    for (let p = 0; p < n; p++) for (let b = 0; b < 3; b++) {
      if (!r.choose('district.bayTaken', {}, { p: 0.75 })) continue;
      const police = r.choose('district.bayPolice', {}, { p: 0.6 });
      const key = police ? r.choose('district.bayPoliceModel', {}, [PS + 'Police_Car_3', PS + 'Police_Car_4']) : r.choose('district.bayCarModel', {}, cars);
      const cx = (px0 + p * 9 + 1.5 + b * 3) * T, fy = (by + 5) * T - 3;
      sb.putFoot(key, cx, fy, 'vehicle', { gid, why: police ? '停在车位里的警车（车头朝通道）' : '工作人员停在车位里的车', depth: 40, ignoreClear: true });
    }
  }
  // the way out: the lower aisle meets the street at the end next to the station, away from the corner crossing (C23),
  // a barrier at the lot edge
  const out = f.x0 === L.bx0 ? f.x1 - 4 : f.x0 + 2;
  driveway(L, sb, r, out, 2, f.y1, gid, '停车场车道：穿过人行道通到马路，路缘在这里断开');
  sb.putFoot(r.choose('district.barrier', {}, [PS + 'Automatic_Barrier_1', PS + 'Automatic_Barrier_2']), (out + 1) * T, f.y1 * T - 1, 'fence', { gid, why: '停车场出入口的自动道闸', occupy: false, ignoreClear: true });
  if (r.choose('district.lotOfficer', {}, { p: 0.6 })) person(sb, r, (f.x0 + w / 2) * T, (rows[rows.length - 1] + 6.5) * T, 'walk', r.choose('district.lotOfficerDir', {}, ['left', 'right'] as const), 'police', gid, '走向警车的警察');
}
