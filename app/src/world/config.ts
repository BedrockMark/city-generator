// Every tunable of the world layer lives here as a named constant (spec 3.8); other files must not hold these numbers.
import type { ZoneKind } from './types';

export const CHUNK = 64;                                   // chunk edge in cells
export const ARTERIAL_SPACING = { x: 120, y: 88 };         // nominal arterial grid pitch
export const ARTERIAL_JITTER = 12;                         // |jitter| <= 12 cells
export const ARTERIAL_JOG = 2;                             // shift of a whole segment between two junctions, 0..2 cells
export const ARTERIAL_WIDTHS = { v: [[5, 4], [7, 2], [9, 1]], h: [[5, 5], [7, 2]] } as const;   // [width, weight] of vertical / horizontal arterials
export const STREET_WIDTH = 5;                             // width of the street between blocks
export const JOG_CHANCE = 0.25;                            // chance a cut is offset midway
export const JOG_STEP = [2, 4] as const;                   // jog offset range
export const ZONE_THRESHOLDS = { downtown: 0.62, residential: 0.38 } as const;   // z >= 0.62 downtown, z < 0.38 residential
export const ZONE_OCTAVE = { scale: 3, weight: 0.5 } as const;   // second noise octave: relative scale and blend weight
export const ZONES: Record<ZoneKind, { lotW: [number, number]; lotH: [number, number]; sw: 2 | 3; paving: readonly (readonly [string, number])[] }> = {
  downtown:    { lotW: [18, 34], lotH: [13, 25], sw: 3, paving: [['sidewalk_lightgrey', 3], ['sidewalk_grey', 2], ['sidewalk_beige', 1]] },
  mixed:       { lotW: [20, 36], lotH: [14, 26], sw: 2, paving: [['sidewalk_lightbeige', 2], ['sidewalk_beige', 2], ['sidewalk_lightgrey', 1], ['sidewalk_brown', 1]] },
  residential: { lotW: [22, 40], lotH: [15, 28], sw: 2, paving: [['sidewalk_lightbeige', 2], ['sidewalk_brown', 2], ['sidewalk_blue', 1]] },
};
export const CROSSING_CHANCE = { arterial: 0.45, street: 0.3 } as const;   // chance of a crosswalk per junction arm
export const CROSSING_MIN_RUN = 8;                         // minimum straight road run (cells) for a crosswalk
export const WINDOW_MARGIN = 14;                           // window overhang beyond the footprint (>= widest road 9 + sidewalk 3 + 2)
export const WINDOW_SW2 = 3;                               // sidewalk width used for the window layout
export const ANALYSIS_PAD = 16;                            // paint / analysis padding around a window
export const REGION_PAD = 6;                               // padding when listing blocks in a region
export const OVERHANG_LIMIT = 'centre' as const;
export const CITY_NOVELTY = 0.10;
export const BLOCK_CACHE = 256;

// Sorted unique road widths derived from the arterial and street widths.
export const ROAD_WIDTHS: readonly number[] = [...new Set<number>([
  ...ARTERIAL_WIDTHS.v.map(w => w[0]),
  ...ARTERIAL_WIDTHS.h.map(w => w[0]),
  STREET_WIDTH,
])].sort((a, b) => a - b);
