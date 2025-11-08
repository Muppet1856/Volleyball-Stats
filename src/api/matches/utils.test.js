import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deserializeMatchRow,
  deserializeMatchSets,
  normalizeMatchPayload,
  serializeMatchSets
} from './utils.js';

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

test('serializes normalized sets to discrete rows', () => {
  const payload = normalizeMatchPayload({
    sets: {
      1: { sc: '25', opp: 22, timeouts: { sc: [true, false], opp: [false, true] } },
      3: { sc: '15', opp: '9' }
    },
    finalizedSets: { 1: true, 2: false }
  });

  const rows = serializeMatchSets(payload.sets, payload.finalizedSets);
  assert.equal(rows.length, 5);

  const first = rows.find((row) => row.setNumber === 1);
  assert.deepEqual(first, {
    setNumber: 1,
    scScore: '25',
    oppScore: '22',
    scTimeout1: 1,
    scTimeout2: 0,
    oppTimeout1: 0,
    oppTimeout2: 1,
    finalized: 1
  });

  const second = rows.find((row) => row.setNumber === 2);
  assert.equal(second.finalized, 0);

  const third = rows.find((row) => row.setNumber === 3);
  assert.equal(third.scScore, '15');
  assert.equal(third.oppScore, '9');
  assert.equal(third.finalized, null);
});

test('deserializes set rows to API shape', () => {
  const { sets, finalizedSets } = deserializeMatchSets([
    {
      set_number: 1,
      sc_score: '25',
      opp_score: '20',
      sc_timeout_1: 1,
      sc_timeout_2: 0,
      opp_timeout_1: 0,
      opp_timeout_2: 1,
      finalized: 1
    },
    {
      set_number: 2,
      sc_score: '18',
      opp_score: '25',
      sc_timeout_1: 0,
      sc_timeout_2: 0,
      opp_timeout_1: 0,
      opp_timeout_2: 0,
      finalized: 0
    }
  ]);

  assert.deepEqual(sets[1], {
    sc: '25',
    opp: '20',
    timeouts: { sc: [true, false], opp: [false, true] }
  });
  assert.deepEqual(sets[3], {
    sc: '',
    opp: '',
    timeouts: { sc: [false, false], opp: [false, false] }
  });
  assert.deepEqual(finalizedSets, { 1: true, 2: false });
});

test('deserializeMatchRow rebuilds payload with set rows', () => {
  const row = {
    id: 7,
    date: '2024-01-01',
    location: 'Home',
    types: JSON.stringify({ league: true }),
    opponent: 'Rivals',
    jersey_color_sc: 'Blue',
    jersey_color_opp: 'Red',
    result_sc: 3,
    result_opp: 1,
    first_server: 'A1',
    players: JSON.stringify(['1', '2', '3']),
    is_swapped: 0
  };

  const setRows = [
    {
      set_number: 1,
      sc_score: '25',
      opp_score: '22',
      sc_timeout_1: 1,
      sc_timeout_2: 0,
      opp_timeout_1: 0,
      opp_timeout_2: 0,
      finalized: 1
    }
  ];

  const match = deserializeMatchRow(row, setRows);

  assert.equal(match.id, 7);
  assert.equal(match.types.league, true);
  assert.deepEqual(match.players, ['1', '2', '3']);
  assert.deepEqual(match.sets[1], {
    sc: '25',
    opp: '22',
    timeouts: { sc: [true, false], opp: [false, false] }
  });
  assert.deepEqual(match.finalizedSets, { 1: true });
});
