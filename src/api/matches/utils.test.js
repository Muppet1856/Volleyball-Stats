import test from 'node:test';
import assert from 'node:assert/strict';

import { deserializeMatchRow, normalizeMatchPayload } from './utils.js';

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

test('normalizes revision when provided', () => {
  const normalized = normalizeMatchPayload({ revision: '5' });
  assert.equal(normalized.revision, 5);

  const missingRevision = normalizeMatchPayload({ revision: '' });
  assert.equal(Object.prototype.hasOwnProperty.call(missingRevision, 'revision'), false);

  const negative = normalizeMatchPayload({ revision: -2 });
  assert.equal(negative.revision, 0);
});

test('deserializeMatchRow returns revision defaulting to zero', () => {
  const result = deserializeMatchRow({ revision: '7' });
  assert.equal(result.revision, 7);

  const fallback = deserializeMatchRow({});
  assert.equal(fallback.revision, 0);
});

test('deserializeMatchRow clamps negative revisions to zero', () => {
  const result = deserializeMatchRow({ revision: '-3' });
  assert.equal(result.revision, 0);
});
