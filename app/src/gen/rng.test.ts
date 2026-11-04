import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng, Trace } from './rng';

const draw = (r: Rng, n = 5) => Array.from({ length: n }, () => r.next());

test('same sequence without reseed', () => {
  const r = new Rng('7', new Trace('7')).fork('a').fork('b');
  assert.deepEqual(draw(r), draw(new Rng('7/a/b')));
  assert.equal(r.stream, 'a/b');
});

test('reseed salts a stream and its descendants only', () => {
  const plain = new Rng('7', new Trace('7'));
  const salted = new Rng('7', new Trace('7', { 'a/b': 3 }));
  const pa = plain.fork('a'), sa = salted.fork('a');
  assert.deepEqual(draw(sa), draw(pa));
  assert.deepEqual(draw(salted.fork('a').fork('x')), draw(plain.fork('a').fork('x')));
  const sb = salted.fork('a').fork('b'), pb = plain.fork('a').fork('b');
  assert.equal(sb.stream, 'a/b');
  assert.notDeepEqual(draw(sb), draw(pb));
  const sc = salted.fork('a').fork('b').fork('c'), pc = plain.fork('a').fork('b').fork('c');
  assert.equal(sc.stream, 'a/b/c');
  assert.notDeepEqual(draw(sc), draw(pc));
});

test('trace keys use logical paths', () => {
  const t = new Trace('7', { 'a/b': 3 });
  const r = new Rng('7', t).fork('a').fork('b', { k: 1 });
  r.choose('x', {}, [1, 2]);
  assert.deepEqual(Object.keys(t.streams), ['a/b']);
  assert.equal((t.decisions[0] as { s: string }).s, 'a/b');
});
