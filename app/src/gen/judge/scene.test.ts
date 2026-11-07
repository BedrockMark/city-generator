import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, VERSION } from '../generate';

test('generate writes scene.judge', () => {
  const j = generate('7').judge!;
  assert.ok(j && j.windows.length > 20);
  assert.ok(j.windows.every(w => w.score >= 0 && w.score <= 1 && w.top.length === 3));
  assert.ok(j.max >= j.mean);
  assert.equal(VERSION, '0.7.3');
});
