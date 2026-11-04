// Generation off the main thread: the judge repair (exp-02) regenerates the map a dozen times or more, which would
// freeze the viewer. Messages in: { id, seed, opts }; out: { id, progress: [n, N] } while repairing, then
// { id, scene } (or { id, error }).
import { generate } from '../gen/generate';
import type { GenOptions } from '../gen/types';

self.onmessage = (e: MessageEvent<{ id: number; seed: string; opts: GenOptions }>) => {
  const { id, seed, opts } = e.data;
  try {
    const scene = generate(seed, opts, (n, N) => self.postMessage({ id, progress: [n, N] }));
    self.postMessage({ id, scene });
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
