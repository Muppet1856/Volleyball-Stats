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

test('deserializes durable object records with defaults applied', () => {
  const record = {
    id: 7,
    date: '2024-01-01',
    location: 'Main Gym',
    types: { tournament: true },
    opponent: 'Rivals',
    jerseyColorHome: 'Blue',
    jerseyColorOpp: 'Red',
    resultHome: '3',
    resultOpp: '1',
    firstServer: 'Alice',
    players: ['1', ' 2 '],
    sets: {
      1: { home: '25', opp: '15', timeouts: { home: [true, false, true], opp: [false] } },
      2: { home: '22', opp: '25', timeouts: { home: [false, true], opp: [true, true] } }
    },
    finalizedSets: { 1: true, 2: false },
    isSwapped: true
  };

  const deserialized = deserializeMatchRow(record);

  assert.equal(deserialized.id, 7);
  assert.equal(deserialized.types.tournament, true);
  assert.equal(deserialized.types.league, false);
  assert.equal(deserialized.resultHome, 3);
  assert.equal(deserialized.resultOpp, 1);
  assert.deepEqual(deserialized.players, ['1', '2']);
  assert.deepEqual(deserialized.finalizedSets, { 1: true, 2: false });
  assert.deepEqual(deserialized.sets[1], {
    home: '25',
    opp: '15',
    timeouts: { home: [true, false], opp: [false, false] }
  });
  assert.deepEqual(deserialized.sets[2], {
    home: '22',
    opp: '25',
    timeouts: { home: [false, true], opp: [true, true] }
  });
  assert.deepEqual(deserialized.sets[3], {
    home: '',
    opp: '',
    timeouts: { home: [false, false], opp: [false, false] }
  });
});

test('deserialized matches retain independent timeout arrays', () => {
  const deserialized = deserializeMatchRow({});

  deserialized.sets[1].timeouts.home[0] = true;

  assert.deepEqual(deserialized.sets[2].timeouts.home, [false, false]);
  assert.notStrictEqual(
    deserialized.sets[1].timeouts.home,
    deserialized.sets[2].timeouts.home
  );
});

test('deserializeMatchRow tolerates partially populated payloads', () => {
  const deserialized = deserializeMatchRow({
    id: 99,
    sets: {
      1: { home: 25, opp: 15, timeouts: { home: [1, 0], opp: ['yes', 'no'] } }
    },
    finalizedSets: null,
    players: null
  });

  assert.equal(deserialized.id, 99);
  assert.deepEqual(deserialized.players, []);
  assert.deepEqual(deserialized.finalizedSets, {});
  assert.deepEqual(deserialized.sets[1], {
    home: '25',
    opp: '15',
    timeouts: { home: [true, false], opp: [true, false] }
  });
});
