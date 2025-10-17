import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeMatchPayload } from './utils.js';

test('normalizes timeout arrays to booleans with fixed length', () => {
  const input = {
    sets: {
      1: { timeouts: { sc: [1, 0, 1], opp: ['yes', null, ''] } },
      2: { timeouts: { sc: { 0: 'true', 1: 'false' }, opp: { 0: 0, 1: 1 } } },
    }
  };

  const normalized = normalizeMatchPayload(input);

  assert.equal(normalized.sets[1].timeouts.sc.length, 2);
  assert.equal(normalized.sets[1].timeouts.opp.length, 2);
  assert.deepEqual(normalized.sets[1].timeouts.sc, [true, false]);
  assert.deepEqual(normalized.sets[1].timeouts.opp, [true, false]);
  assert.deepEqual(normalized.sets[2].timeouts.sc, [true, false]);
  assert.deepEqual(normalized.sets[2].timeouts.opp, [false, true]);
});

test('produces fresh timeout arrays per set', () => {
  const normalized = normalizeMatchPayload({});

  normalized.sets[1].timeouts.sc[0] = true;

  assert.deepEqual(normalized.sets[2].timeouts.sc, [false, false]);
  assert.notStrictEqual(normalized.sets[1].timeouts.sc, normalized.sets[2].timeouts.sc);
});
