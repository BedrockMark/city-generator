// Scene format produced by the generator. Consumed by the Phaser renderer and (after export) by the
// Python evaluation tools (tools/eval_generated.py).

export const TILE = 16;

export const SHEETS = {
  city: 'exteriors/2_City_Terrains_16x16.png',
  auto: 'exterior_autotiles/Game_Maker_Studio_Autotiles_16x16.png',
  terr: 'exteriors/1_Terrains_and_Fences_16x16.png',
} as const;
export type SheetKey = keyof typeof SHEETS;
export const SHEET_COLS: Record<SheetKey, number> = { city: 59, auto: 12, terr: 32 };

/** [sheet, col, row] of a 16x16 tile */
export type TileRef = [SheetKey, number, number];

/** semantic class of a grid cell */
export type CellClass = 'road' | 'walk' | 'lot' | 'nwalk' | 'nlot';

export interface Placed {
  kind: 'sprite' | 'char';
  /** sprite: "<pack>/<name>" key; char: outfit layer path (for reference) */
  key: string;
  /** sprite: asset path relative to assets/; char: '' (see layers) */
  file: string;
  /** char only: layer sheet paths in draw order, and frame [col,row] in the 16x32 grid */
  layers?: string[];
  frame?: [number, number];
  x: number; y: number; w: number; h: number;   // px, top-left of the sprite image
  /** depth-sort key in px (the y where the thing stands); ties broken by `sub` */
  foot: number;
  sub?: number;
  /** buildings: px y of the footprint top. The sprite above it is not solid (ground behind the building);
   *  the viewer's ghost mode draws that part translucent so what happens behind tall buildings is visible */
  solid?: number;
  cls: string;          // semantic class (tree, lamp, building, person ...)
  // ---- explanation (stage 4); never read by the generator itself ----
  /** object id within the scene ("o12"); stable for a given version + seed + options */
  id?: string;
  /** group type (bus, front, curb-trees, building ...) and group instance id (bus#0, front:b7, bld:b3) */
  group?: string;
  gid?: string;
  /** one sentence: why this thing is here */
  reason?: string;
  /** what it is attached to (door, crossing, curb run, table ...) */
  anchor?: Anchor;
  /** id of the experimental feature that produced it (exp-03), if any */
  exp?: string;
  /** sprite chosen because it is rarely / never used (novelty, stage 7) */
  novel?: boolean;
  /** ground footprint (px) the placement occupied; absent for things that do not stand on the ground */
  fp?: PxRect;
  /** random stream (logical fork path) it was drawn from; write-only (stage 6 judge repair) */
  stream?: string;
}

/** the thing a placement or group hangs off; (x, y) is the point the viewer draws the link line to */
export interface Anchor { kind: 'door' | 'crossing' | 'curb' | 'zone' | 'yard' | 'road' | 'building' | 'object' | 'block' | 'slot'; ref: string; x: number; y: number }

export interface PxRect { x0: number; y0: number; x1: number; y1: number }

export interface GroupRec {
  gid: string;
  type: string;
  /** trigger: why this group instance exists */
  reason: string;
  anchor?: Anchor;
  exp?: string;
  stream?: string;
  /** object ids, and the union of their opaque boxes (px) */
  members: string[];
  bbox?: PxRect;
}

export interface BuildingRec {
  gid: string;
  id: string;
  label: string;
  front: string;
  block: 'main' | 'neigh';
  /** S = facade on the street, N = facade on the courtyard */
  side: 'S' | 'N';
  /** whole sprite rect and the solid footprint (roof-sized, D16), px */
  rect: PxRect;
  solid: PxRect;
  doors: { x: number; y: number }[];
  /** why the packer put it here */
  reason: string;
}

/** an area with a purpose: keep-clear zones (why it is empty), yard allocation, curb runs, carriageway */
export interface ZoneRec {
  id: string;
  layer: 'keepclear' | 'yard' | 'curb' | 'road' | 'block';
  kind: string;
  rect: PxRect;
  reason: string;
  gid?: string;
  exp?: string;
  stream?: string;
}

export interface Scene {
  version: string;
  seed: string;
  params: Record<string, unknown>;
  cols: number; rows: number; tile: number;
  sheets: typeof SHEETS;
  /** ground layers, bottom first; each layer rows x cols */
  ground: (TileRef | null)[][][];
  objects: Placed[];
  cells: CellClass[][];
  notes: string[];
  // ---- explanation (stage 4) ----
  options?: GenOptions;
  groups?: GroupRec[];
  buildings?: BuildingRec[];
  zones?: ZoneRec[];
  /** stage 5: constraint audit and rationalising repairs (rational/rationalize.ts Audit) */
  audit?: import('./rational/rationalize').Audit;
  /** stage 6: oddness score of every window (judge/model.ts) */
  judge?: import('./judge/model').JudgeResult;
  /** stage 6 judge repair record (exp-02, judge/repair.ts) */
  judgeRepair?: import('./judge/repair').JudgeRepair;
  /** random decision trace (rng.ts Trace) */
  trace?: { decisions: unknown[]; streams: Record<string, unknown>; textures: Record<string, Record<string, number>>; unlabelled: number };
}

export interface GenOptions {
  /** 0..1, 0 = fully conservative (stage 7; recorded with every export) */
  novelty: number;
  /** master switch for experimental features */
  experiments: boolean;
  /** per-feature switches (missing = registry default) */
  exp: Record<string, boolean>;
  /** stage 5: repair with the confirmed (active) constraints */
  prune: boolean;
  /** stage 5 preview: also repair with the draft constraints */
  pruneDraft: boolean;
  /** stage 6: logical stream path -> salt (rng.ts); the judge repair writes the salts it adopted here */
  reseed?: Record<string, number>;
  /** stage 6: the judge repair's result (salts in `reseed`, plus these downgraded windows): regenerate it as is,
   *  without searching (an exported scene reproduces) */
  judgeFixed?: { degrade: PxRect[]; global?: boolean };
  /** stage 6: global tier of the judge repair (re-pack the main block); off by default */
  judgeGlobal?: boolean;
  /** internal: false = no judge repair (its own candidates) */
  judgeRepair?: boolean;
}
