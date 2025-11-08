import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deserializeMatchRow,
  hydrateMatchSets,
  mapMatchPayloadToRow,
  mapMatchSetsToRows,
  normalizeMatchPayload
} from './utils.js';

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

test('maps normalized payload to row structures', () => {
  const normalized = normalizeMatchPayload({
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
      1: { home: '25', opp: '15', timeouts: { home: [true, false], opp: [false, false] } },
      2: { home: '22', opp: '25', timeouts: { home: [false, true], opp: [true, true] } }
    },
    finalizedSets: { 1: true, 2: false },
    isSwapped: true
  });

  const row = mapMatchPayloadToRow(normalized);
  assert.deepEqual(JSON.parse(row.types), {
    tournament: true,
    league: false,
    postSeason: false,
    nonLeague: false
  });
  assert.equal(row.is_swapped, 1);
  assert.equal(row.result_home, 3);
  assert.equal(row.result_opp, 1);

  const setRows = mapMatchSetsToRows(7, normalized.sets);
  assert.equal(setRows.length, 5);
  assert.deepEqual(setRows[0], {
    matchId: 7,
    setNumber: 1,
    homeScore: 25,
    oppScore: 15,
    homeTimeout1: 1,
    homeTimeout2: 0,
    oppTimeout1: 0,
    oppTimeout2: 0
  });
  assert.equal(setRows[1].homeScore, 22);
  assert.equal(setRows[1].oppScore, 25);
  assert.equal(setRows[1].oppTimeout2, 1);
  assert.equal(setRows[2].homeScore, null);
});

test('hydrates match rows with set data', () => {
  const hydrated = hydrateMatchSets([
    {
      set_number: 3,
      home_score: 15,
      opp_score: 13,
      home_timeout_1: 1,
      home_timeout_2: 0,
      opp_timeout_1: 0,
      opp_timeout_2: 1
    }
  ]);

  assert.equal(hydrated[1].home, '');
  assert.deepEqual(hydrated[1].timeouts.home, [false, false]);
  assert.deepEqual(hydrated[3], {
    home: '15',
    opp: '13',
    timeouts: { home: [true, false], opp: [false, true] }
  });
  assert.notStrictEqual(hydrated[2].timeouts.home, hydrated[3].timeouts.home);
});

test('round-trips normalized payload through serialization helpers', () => {
  const normalized = normalizeMatchPayload({
    date: '2024-02-02',
    location: 'Arena',
    types: { league: true },
    opponent: 'Sharks',
    jerseyColorHome: 'White',
    jerseyColorOpp: 'Black',
    resultHome: 2,
    resultOpp: 3,
    firstServer: 'Bob',
    players: ['5', '6'],
    sets: {
      1: { home: '25', opp: '20', timeouts: { home: [true, false], opp: [false, false] } },
      2: { home: '18', opp: '25', timeouts: { home: [false, false], opp: [true, false] } },
      3: { home: '', opp: '', timeouts: { home: [false, false], opp: [false, false] } }
    },
    finalizedSets: { 1: true },
    isSwapped: false
  });

  const row = mapMatchPayloadToRow(normalized);
  const setRows = mapMatchSetsToRows(42, normalized.sets);

  const deserialized = deserializeMatchRow(
    {
      id: 42,
      date: row.date,
      location: row.location,
      types: row.types,
      opponent: row.opponent,
      jersey_color_home: row.jersey_color_home,
      jersey_color_opp: row.jersey_color_opp,
      result_home: row.result_home,
      result_opp: row.result_opp,
      first_server: row.first_server,
      players: row.players,
      finalized_sets: row.finalized_sets,
      is_swapped: row.is_swapped
    },
    setRows
  );

  assert.equal(deserialized.id, 42);
  assert.equal(deserialized.types.league, true);
  assert.equal(deserialized.isSwapped, false);
  assert.deepEqual(deserialized.players, normalized.players);
  assert.deepEqual(deserialized.finalizedSets, normalized.finalizedSets);
  assert.deepEqual(deserialized.sets[1], normalized.sets[1]);
  assert.deepEqual(deserialized.sets[2], normalized.sets[2]);
  assert.deepEqual(deserialized.sets[3], normalized.sets[3]);
});
