// Every tunable of the world layer lives here as a named constant (spec 3.8); other files must not hold these numbers.
import type { ZoneKind } from './types';

export const CHUNK = 64;                                   // chunk edge in cells; reserved (spec 3.8 name; used from v0.8.1)
export const ARTERIAL_SPACING = { x: 120, y: 88 };         // nominal arterial grid pitch
export const ARTERIAL_JITTER = 12;                         // |jitter| <= 12 cells
export const ARTERIAL_JOG = 2;                             // shift of a whole segment between two junctions, 0..2 cells
// [width, weight] of vertical / horizontal arterials. Every line (dashed or the double solid centre line) takes a cell of
// its own and every lane ARTERIAL_LANE cells, so n lanes each way need 2n * (ARTERIAL_LANE + 1) - 1 cells:
// 11 = lane | dash | lane | double | lane | dash | lane (2 + 1 + 2 + 1 + 2 + 1 + 2), 17 = three lanes each way
export const ARTERIAL_WIDTHS = { v: [[11, 3], [17, 1]], h: [[11, 1]] } as const;
export const ARTERIAL_LANE = 2;                            // cells of one arterial lane (between a curb or line and the next line)
export const STREET_WIDTH = 5;                             // width of the street between blocks
export const JOG_CHANCE = 0.25;                            // chance a cut is offset midway
export const JOG_STEP = [2, 4] as const;                   // jog offset range
export const JOG_AT = [0.3, 0.7] as const;                 // where along the cut the jog happens, as a fraction of its length
export const JOG_GAP = 3;                                  // the two sides of a jog step this many cells apart (>= one lane), the street widening in between
export const LEAF_CHANCE = 0.5;                            // chance an in-range rect stops splitting even though it could split
export const CELL_CACHE = 256;                             // arterial cells whose block lists are cached
export const ZONE_THRESHOLDS = { downtown: 0.62, residential: 0.38 } as const;   // z >= 0.62 downtown, z < 0.38 residential
export const ZONE_OCTAVE = { scale: 3, weight: 0.5 } as const;   // second noise octave: relative scale and blend weight
export const ZONES: Record<ZoneKind, { lotW: [number, number]; lotH: [number, number]; sw: 2 | 3; paving: readonly (readonly [string, number])[] }> = {
  downtown:    { lotW: [18, 34], lotH: [13, 25], sw: 3, paving: [['sidewalk_lightgrey', 3], ['sidewalk_grey', 2], ['sidewalk_beige', 1]] },
  mixed:       { lotW: [20, 36], lotH: [14, 26], sw: 2, paving: [['sidewalk_lightbeige', 2], ['sidewalk_beige', 2], ['sidewalk_lightgrey', 1], ['sidewalk_brown', 1]] },
  residential: { lotW: [22, 40], lotH: [15, 28], sw: 2, paving: [['sidewalk_lightbeige', 2], ['sidewalk_brown', 2], ['sidewalk_blue', 1]] },
};
export const CROSSING_CHANCE = { arterial: 0.9, street: 0.9 } as const;   // chance of a crosswalk per junction arm
export const CROSSING_MIN_RUN = 8;                         // minimum straight road run (cells) for a crosswalk
export const CROSSING_LEN = 2;                             // zebra length along the road (cells)
export const CROSSING_GAP = [0, 1] as const;               // gap range between the junction and the zebra (cells)
export const DASH_MIN_RUN = 6;                             // minimum corridor length (cells) that gets centre dashes
export const WINDOW_MARGIN = 22;                           // window overhang beyond the footprint (>= widest road 17 + sidewalk 3 + 2)
export const SLAB_PERIOD = [4, 2] as const;                 // paving slab pattern period (gen/layout slab): window corners snap to it
export const WINDOW_SW2 = 3;                               // sidewalk width used for the window layout
export const ANALYSIS_PAD = 24;                            // paint / analysis padding around a window
// Padding when listing blocks in a region: a road cell is at most half a road width from its owner's sidewalk, and
// an arterial jog widens the band locally by ARTERIAL_JOG, so ceil((widest arterial + ARTERIAL_JOG) / 2) (= 6).
export const REGION_PAD = Math.ceil((Math.max(...[...ARTERIAL_WIDTHS.v, ...ARTERIAL_WIDTHS.h].map(w => w[0])) + ARTERIAL_JOG) / 2);
export const OVERHANG_LIMIT = 'centre' as const;           // upper floors never overhang past the road centre line; reserved (spec 3.8 name; used from v0.8.1)
export const CITY_NOVELTY = 0.10;                          // novelty every world block is generated with (fixed in city mode, spec 3.9)
export const BLOCK_CACHE = 256;                            // finished block scenes kept by generateBlock's LRU

// Sorted unique road widths derived from the arterial and street widths.
export const ROAD_WIDTHS: readonly number[] = [...new Set<number>([
  ...ARTERIAL_WIDTHS.v.map(w => w[0]),
  ...ARTERIAL_WIDTHS.h.map(w => w[0]),
  STREET_WIDTH,
])].sort((a, b) => a - b);
