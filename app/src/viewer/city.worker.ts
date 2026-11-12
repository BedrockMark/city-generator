// City-mode generation off the main thread. Messages in/out are documented in pool.ts's users (see viewer).
//   in { id, kind:'block', seed, blockId }                          out { id, block }
//   in { id, kind:'chunk', seed, cx, cy, blocks, missing }          out { id, chunk }
//   in { id, kind:'scene', seed, blockId }                          out { id, scene }
//   failure: out { id, error }
import { assembleChunk, getBlock, trimBlock, type CityBlock } from '../world/chunk';
import { generateBlock } from '../world/window';

type Msg =
  | { id: number; kind: 'block'; seed: string; blockId: string }
  | { id: number; kind: 'chunk'; seed: string; cx: number; cy: number; blocks: CityBlock[]; missing: string[] }
  | { id: number; kind: 'scene'; seed: string; blockId: string };

self.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data;
  try {
    if (m.kind === 'block') {
      self.postMessage({ id: m.id, block: trimBlock(m.blockId, generateBlock(m.seed, m.blockId)) });
    } else if (m.kind === 'chunk') {
      const map = new Map(m.blocks.map(b => [b.id, b] as const));
      for (const id of m.missing) map.delete(id);
      self.postMessage({ id: m.id, chunk: assembleChunk(m.seed, m.cx, m.cy, id => map.get(id)) });
    } else {
      self.postMessage({ id: m.id, scene: getBlock(m.seed, m.blockId) });
    }
  } catch (err) {
    self.postMessage({ id: m.id, error: String(err) });
  }
};
