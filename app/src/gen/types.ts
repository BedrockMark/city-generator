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
  group?: string;       // vignette / building id this element belongs to
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
}
