// Generation off the main thread (~0.3 s a map), so the viewer stays responsive.
// Messages in: { id, seed, opts }; out: { id, scene } (or { id, error }).
import { generate } from '../gen/generate';
import type { GenOptions } from '../gen/types';

self.onmessage = (e: MessageEvent<{ id: number; seed: string; opts: GenOptions }>) => {
  const { id, seed, opts } = e.data;
  try {
    self.postMessage({ id, scene: generate(seed, opts) });
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
