import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorkerPool, poolSize, type WorkerLike } from './pool';

class Fake implements WorkerLike {
  posted: any[] = []; terminated = false;
  onmessage: WorkerLike['onmessage'] = null; onerror: WorkerLike['onerror'] = null;
  postMessage(m: unknown) { this.posted.push(m); }
  terminate() { this.terminated = true; }
  reply(d: object) { this.onmessage!({ data: d }); }
}
const make = (size: number) => {
  const ws: Fake[] = [];
  const pool = new WorkerPool(() => { const w = new Fake(); ws.push(w); return w; }, size);
  return { ws, pool };
};
const tick = () => new Promise(r => setImmediate(r));

test('runs at most size jobs at once and queues the rest in order', async () => {
  const { ws, pool } = make(2);
  const p = [1, 2, 3].map(n => pool.run<any>({ n }));
  assert.equal(pool.free, 0);
  assert.equal(ws[0].posted.length + ws[1].posted.length, 2);
  const first = ws[0].posted[0];
  ws[0].reply({ id: first.id, ok: 1 });
  await p[0];
  assert.deepEqual(ws[0].posted.map(m => m.n), [1, 3]);
  ws[1].reply({ id: ws[1].posted[0].id });
  ws[0].reply({ id: ws[0].posted[1].id });
  await Promise.all(p);
  assert.equal(pool.free, 2);
});

test('urgent jobs go before queued ones', async () => {
  const { ws, pool } = make(1);
  const a = pool.run({ n: 'a' }); pool.run({ n: 'b' }); pool.run({ n: 'c' }, true);
  ws[0].reply({ id: ws[0].posted[0].id });
  await a;
  assert.equal(ws[0].posted[1].n, 'c');
});

test('an error reply rejects that job only', async () => {
  const { ws, pool } = make(2);
  const a = pool.run({}); const b = pool.run({});
  ws[0].reply({ id: ws[0].posted[0].id, error: 'x' });
  await assert.rejects(a, /x/);
  ws[1].reply({ id: ws[1].posted[0].id, v: 1 });
  assert.deepEqual(await b, { id: ws[1].posted[0].id, v: 1 });
  assert.equal(pool.free, 2);
});

test('a crashed worker is replaced and its job rejected', async () => {
  const { ws, pool } = make(2);
  const a = pool.run({}); pool.run({});
  assert.equal(pool.free, 0);
  ws[0].onerror!({ message: 'boom' });
  await assert.rejects(a, /boom/);
  await tick();
  assert.ok(ws[0].terminated);
  assert.equal(ws.length, 3);
  assert.equal(pool.free, 1);
});

test('poolSize', () => {
  assert.equal(poolSize(16), 8);
  assert.equal(poolSize(4), 3);
  assert.equal(poolSize(1), 1);
  assert.equal(poolSize(undefined), 1);
});
