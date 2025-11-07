import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeMatchPayload } from './utils.js';

test('normalizes timeout arrays to booleans with fixed length', () => {
  const input = {
    sets: {
      1: { timeouts: { home: [1, 0, 1], opp: ['yes', null, ''] } },
      2: { timeouts: { home: { 0: 'true', 1: 'false' }, opp: { 0: 0, 1: 1 } } },
    }
  };

  const normalized = normalizeMatchPayload(input);

  assert.equal(normalized.sets[1].timeouts.home.length, 2);
  assert.equal(normalized.sets[1].timeouts.opp.length, 2);
  assert.deepEqual(normalized.sets[1].timeouts.home, [true, false]);
  assert.deepEqual(normalized.sets[1].timeouts.opp, [true, false]);
  assert.deepEqual(normalized.sets[2].timeouts.home, [true, false]);
  assert.deepEqual(normalized.sets[2].timeouts.opp, [false, true]);
});

test('produces fresh timeout arrays per set', () => {
  const normalized = normalizeMatchPayload({});

  normalized.sets[1].timeouts.home[0] = true;

  assert.deepEqual(normalized.sets[2].timeouts.home, [false, false]);
  assert.notStrictEqual(normalized.sets[1].timeouts.home, normalized.sets[2].timeouts.home);
});

test('normalizes time value to a trimmed string', () => {
  const normalizedWithTime = normalizeMatchPayload({ time: ' 7:05 PM ' });
  assert.equal(normalizedWithTime.time, '7:05 PM');

  const normalizedEmptyTime = normalizeMatchPayload({ time: '   ' });
  assert.equal(normalizedEmptyTime.time, '');

  const normalizedMissingTime = normalizeMatchPayload({});
  assert.equal(normalizedMissingTime.time, '');
});
