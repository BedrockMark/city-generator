// Shared types of the world layer. Rects are half-open [x0, x1) x [y0, y1) in world cells.

import type { DistrictKind } from '../gen/district';

export interface Rect { x0: number; y0: number; x1: number; y1: number }
export type ZoneKind = 'downtown' | 'mixed' | 'residential';
export interface BlockRec {
  id: string;                  // `b${i},${j}/${path}`; path is made of 'L' / 'R', the root is ''; a notch island ends in 'I';
                               // a roundabout's centre island is `r${i},${j}` (junction i, j)
  cell: [number, number];
  foot: Rect[];                // footprint (sidewalk ring + lot): 1 rect, 2 for a jog or notch block
  cut?: Rect[];                // footprint cells cut out (row runs): a roundabout's road over a corner block
  paved?: Rect[];              // footprint cells kept as sidewalk, never lot: R of a roundabout ∩ the footprint
  sw: 2 | 3;                   // sidewalk width
  zone: ZoneKind;
  paving: string;              // one of SIDEWALK_STYLES
  shape: 'rect' | 'jog' | 'notch' | 'island' | 'roundabout';   // notch: a corner cut off by a short street; island: that corner; roundabout: a centre island
  why: string[];
  district?: DistrictKind;     // set by the district pass (v0.8.2 Task 2)
  centre?: 'plaza' | 'garden'; // a big rect block keeps its middle for a plaza (downtown / mixed) or garden (residential)
}
export type WorldCls = 'road' | 'walk' | 'lot';
export interface WorldCell { cls: WorldCls; block?: string; arterial?: boolean }
export interface WCrossing { axis: 'h' | 'v'; band0: number; band1: number; at: number }   // world coords, like gen/layout Crossing
