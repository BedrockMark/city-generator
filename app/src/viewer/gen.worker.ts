// Generation off the main thread: the judge repair (exp-02) regenerates the map a dozen times or more, which would
// freeze the viewer. Messages in: { id, seed, opts }; out: { id, progress: [n, N] } while repairing, then
// { id, scene } (or { id, error }).
// Stage 7 A/B: in { id, ab: req } (learn/ab.ts makeQuestion); out: { id, progress: [n, N] } per candidate tried,
// then { id, ab: { q, a, b } } (or { id, error }).
import { generate } from '../gen/generate';
import { makeQuestion, type AbRequest } from '../gen/learn/ab';
import type { GenOptions } from '../gen/types';

type Req = { id: number; seed: string; opts: GenOptions } | { id: number; ab: AbRequest };

self.onmessage = (e: MessageEvent<Req>) => {
  const { id } = e.data;
  const progress = (n: number, N: number) => self.postMessage({ id, progress: [n, N] });
  try {
    if ('ab' in e.data) self.postMessage({ id, ab: makeQuestion(e.data.ab, progress) });
    else self.postMessage({ id, scene: generate(e.data.seed, e.data.opts, progress) });
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
