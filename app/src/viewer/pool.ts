// Fixed-size worker pool: jobs are queued when every worker is busy; replies are matched by id.
import { WORKERS_MAX } from '../world/config';

export interface WorkerLike {
  postMessage(m: unknown): void;
  terminate(): void;
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: ((e: { message?: string }) => void) | null;
}

interface Job { id: number; msg: object; resolve: (v: any) => void; reject: (e: Error) => void }
interface Slot { w: WorkerLike; job: Job | null }

export class WorkerPool {
  private slots: Slot[] = [];
  private queue: Job[] = [];
  private nextId = 1;
  private dead = false;

  constructor(private spawn: () => WorkerLike, size: number) {
    for (let i = 0; i < size; i++) this.slots.push(this.makeSlot());
  }

  get free(): number { return this.slots.filter(s => !s.job).length; }

  run<R>(msg: object, urgent = false): Promise<R> {
    if (this.dead) return Promise.reject(new Error('pool terminated'));
    return new Promise<R>((resolve, reject) => {
      const job: Job = { id: this.nextId++, msg, resolve, reject };
      if (urgent) this.queue.unshift(job); else this.queue.push(job);
      this.pump();
    });
  }

  terminate(): void {
    this.dead = true;
    for (const s of this.slots) {
      s.w.onmessage = s.w.onerror = null;
      s.w.terminate();
      s.job?.reject(new Error('pool terminated'));
      s.job = null;
    }
    this.slots = [];
    for (const j of this.queue) j.reject(new Error('pool terminated'));
    this.queue = [];
  }

  private makeSlot(): Slot {
    const slot: Slot = { w: this.spawn(), job: null };
    this.attach(slot);
    return slot;
  }

  private attach(slot: Slot): void {
    const w = slot.w;
    w.onmessage = e => {
      const d = e.data as { id: number; error?: string };
      const job = slot.job;
      if (!job || d.id !== job.id) return;
      slot.job = null;
      if (d.error !== undefined) job.reject(new Error(d.error)); else job.resolve(d);
      this.pump();
    };
    w.onerror = e => {
      const job = slot.job;
      slot.job = null;
      w.onmessage = w.onerror = null;
      w.terminate();
      if (this.dead) return;
      job?.reject(new Error(e.message ?? 'worker crashed'));   // settle the job before spawn() can throw
      slot.w = this.spawn();
      this.attach(slot);
      this.pump();
    };
  }

  private pump(): void {
    for (const s of this.slots) {
      if (s.job) continue;
      const job = this.queue.shift();
      if (!job) return;
      s.job = job;
      s.w.postMessage({ ...job.msg, id: job.id });
    }
  }
}

export function poolSize(cores: number | undefined): number {
  return Math.max(1, Math.min(WORKERS_MAX, (cores ?? 2) - 1));
}
