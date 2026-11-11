// Shared types of the world layer. Rects are half-open [x0, x1) x [y0, y1) in world cells.

export interface Rect { x0: number; y0: number; x1: number; y1: number }
export type ZoneKind = 'downtown' | 'mixed' | 'residential';
export interface BlockRec {
  id: string;                  // `b${i},${j}/${path}`; path is made of 'L' / 'R' (or 'T' / 'B'), the root is ''
  cell: [number, number];
  foot: Rect[];                // footprint (sidewalk ring + lot): 1 rect, 2 for a jog block
  sw: 2 | 3;                   // sidewalk width
  zone: ZoneKind;
  paving: string;              // one of SIDEWALK_STYLES
  shape: 'rect' | 'jog';
  why: string[];
}
export type WorldCls = 'road' | 'walk' | 'lot';
export interface WorldCell { cls: WorldCls; block?: string; arterial?: boolean }
export interface WCrossing { axis: 'h' | 'v'; band0: number; band1: number; at: number }   // world coords, like gen/layout Crossing
