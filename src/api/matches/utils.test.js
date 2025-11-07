import test from 'node:test';
import assert from 'node:assert/strict';

import { deserializeMatchRow, normalizeMatchPayload } from './utils.js';

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

test('normalizes match type to an integer within range', () => {
  const normalized = normalizeMatchPayload({ type: '3' });
  assert.equal(normalized.type, 3);

  const normalizedDefault = normalizeMatchPayload({ type: 'not-a-number' });
  assert.equal(normalizedDefault.type, 0);

  const normalizedOutOfRange = normalizeMatchPayload({ type: 99 });
  assert.equal(normalizedOutOfRange.type, 0);
});

test('deserializes match rows with numeric type', () => {
  const row = {
    id: 1,
    date: '2024-05-01T12:00:00Z',
    location: 'Home',
    type: '2',
    opponent: 'Rivals',
    jersey_color_home: 'blue',
    jersey_color_opp: 'white',
    result_home: 3,
    result_opp: 1,
    first_server: 'home',
    players: JSON.stringify(['10']),
    sets: JSON.stringify({}),
    finalized_sets: JSON.stringify({}),
    is_swapped: 0
  };

  const deserialized = deserializeMatchRow(row);

  assert.equal(deserialized.type, 2);
});
