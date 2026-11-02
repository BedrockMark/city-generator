// Explanation of the ground itself: carriageway segments and crossings as zones, so the annotation layer can
// say why a stretch of road is empty. Called after generation; reads the layout only.
import type { Layout } from './layout';
import type { SceneBuilder } from './place';
import type { CurbRun } from './vignettes';
import { TILE as T } from './types';

export function explainGround(L: Layout, sb: SceneBuilder, runs: CurbRun[]) {
  void runs;
  for (const [i, sg] of L.segs.entries()) {
    const r = sg.axis === 'h' ? { x0: sg.a * T, y0: sg.band0 * T, x1: sg.b * T, y1: sg.band1 * T } : { x0: sg.band0 * T, y0: sg.a * T, x1: sg.band1 * T, y1: sg.b * T };
    sb.zone('road', 'carriageway', r, `车行道 seg${i}（${sg.band1 - sg.band0} 格宽，${sg.axis === 'h' ? '东西' : '南北'}向）：只放车、井盖、施工；路缘设施不进车道`);
  }
  for (const [i, c] of L.crossings.entries()) {
    const r = c.axis === 'h' ? { x0: c.at * T, y0: c.band0 * T, x1: (c.at + 2) * T, y1: c.band1 * T } : { x0: c.band0 * T, y0: c.at * T, x1: c.band1 * T, y1: (c.at + 2) * T };
    sb.zone('road', 'zebra', r, `人行横道 zebra${i}：路口旁的横道（每个路口 0–2 条，和主街区相关的路口更多）`, `crossing#${i}`);
  }
}
