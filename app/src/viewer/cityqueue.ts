// Pure job scheduler for the city viewer's worker pool (no Phaser, no worker APIs).
import type { CityBlock } from '../world/chunk';
import { BLOCK_CACHE } from '../world/config';

export type CityJob =
  | { kind: 'block'; epoch: number; id: string }
  | { kind: 'chunk'; epoch: number; cx: number; cy: number; blocks: CityBlock[]; missing: string[] };

const key = (cx: number, cy: number) => `${cx},${cy}`;

export class CityQueue {
  epoch = 0;
  private wanted: [number, number][] = [];
  private running = new Set<string>();      // block ids in flight
  private failed = new Set<string>();
  private assembling = new Set<string>();   // chunk keys in flight
  private cache = new Map<string, CityBlock>();   // insertion order = LRU order (oldest first)

  constructor(private blocksOf: (cx: number, cy: number) => string[], private cacheSize: number = BLOCK_CACHE) {}

  want(chunks: [number, number][]): void {
    this.wanted = chunks.map(([cx, cy]) => [cx, cy]);
  }

  next(): CityJob | null {
    for (const [cx, cy] of this.wanted) {
      if (this.assembling.has(key(cx, cy))) continue;
      const ids = this.blocksOf(cx, cy);
      if (!ids.every(id => this.cache.has(id) || this.failed.has(id))) continue;
      this.assembling.add(key(cx, cy));
      const sorted = [...ids].sort();
      const blocks: CityBlock[] = [], missing: string[] = [];
      for (const id of sorted) {
        const b = this.touch(id);
        if (b) blocks.push(b); else missing.push(id);
      }
      return { kind: 'chunk', epoch: this.epoch, cx, cy, blocks, missing };
    }
    for (const [cx, cy] of this.wanted) {
      for (const id of this.blocksOf(cx, cy)) {
        if (this.cache.has(id) || this.running.has(id) || this.failed.has(id)) continue;
        this.running.add(id);
        return { kind: 'block', epoch: this.epoch, id };
      }
    }
    return null;
  }

  blockDone(epoch: number, id: string, b: CityBlock | null): void {
    if (epoch !== this.epoch) return;
    this.running.delete(id);
    if (!b) { this.failed.add(id); return; }
    this.cache.delete(id);
    this.cache.set(id, b);
    this.evict();
  }

  chunkDone(epoch: number, cx: number, cy: number): boolean {
    if (epoch !== this.epoch) return false;
    this.assembling.delete(key(cx, cy));
    const i = this.wanted.findIndex(([x, y]) => x === cx && y === cy);
    if (i < 0) return false;
    this.wanted.splice(i, 1);
    return true;
  }

  block(id: string): CityBlock | undefined { return this.touch(id); }

  reset(): void {
    this.epoch++;
    this.wanted = [];
    this.running.clear();
    this.failed.clear();
    this.assembling.clear();
    this.cache.clear();
  }

  get idle(): boolean {
    return this.wanted.length === 0 && this.running.size === 0 && this.assembling.size === 0;
  }

  private touch(id: string): CityBlock | undefined {
    const b = this.cache.get(id);
    if (b) { this.cache.delete(id); this.cache.set(id, b); }
    return b;
  }

  // Drop least-recently-used blocks beyond cacheSize, skipping those a wanted chunk still needs.
  private evict(): void {
    if (this.cache.size <= this.cacheSize) return;
    const needed = new Set<string>();
    for (const [cx, cy] of this.wanted) for (const id of this.blocksOf(cx, cy)) needed.add(id);
    for (const id of [...this.cache.keys()]) {
      if (this.cache.size <= this.cacheSize) break;
      if (!needed.has(id)) this.cache.delete(id);
    }
  }
}
