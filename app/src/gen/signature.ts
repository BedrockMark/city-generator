// The visual signature of a scene: exactly what the renderers draw (ground tiles + sprite / char draw list), so
// "signature equal" means "picture identical"; explanation fields (gid, reason, trace, stream, exp ...) are ignored.
import type { Scene } from './types';

export function signature(sc: Scene) {
  return {
    cols: sc.cols, rows: sc.rows, ground: sc.ground,
    objects: sc.objects.map(o => [o.kind, o.file, o.key, o.x, o.y, o.foot, o.sub ?? 0, o.solid ?? null, o.layers ?? null, o.frame ?? null]),
  };
}
