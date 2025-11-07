import test from 'node:test';
import assert from 'node:assert/strict';

const createEmptyScore = () => ({ home: 0, away: 0 });
const parseJsonSafe = (value, fallback) => {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
};

globalThis.createEmptyScore = createEmptyScore;
globalThis.parseLiveScore = (value) => {
  if (!value) {
    return createEmptyScore();
  }
  if (typeof value === 'string') {
    const parsed = parseJsonSafe(value, null);
    if (parsed) {
      return {
        home: Number(parsed.home ?? 0),
        away: Number(parsed.away ?? 0)
      };
    }
    return createEmptyScore();
  }
  if (typeof value === 'object') {
    return {
      home: Number(value.home ?? 0),
      away: Number(value.away ?? 0)
    };
  }
  return createEmptyScore();
};
globalThis.parseTimeouts = (value) => {
  const parsed = parseJsonSafe(value, { home: [], away: [] });
  const normalize = (list) => {
    if (!Array.isArray(list)) {
      return [false, false];
    }
    return [Boolean(list[0]), Boolean(list[1])];
  };
  return {
    home: normalize(parsed.home),
    opp: normalize(parsed.opp)
  };
};
globalThis.parseJsonField = (value, fallback) => parseJsonSafe(value, fallback);
globalThis.normalizeMatchIdentifier = (value) => {
  const numeric = Number.parseInt(value, 10);
  if (Number.isNaN(numeric)) {
    throw new Error('Invalid identifier');
  }
  return {
    dbValue: numeric,
    text: String(numeric),
    numeric
  };
};
globalThis.prepareSetPayloadForPersistence = (input = {}) => ({
  matchID: Number.parseInt(input.match_id ?? input.matchID ?? 0, 10),
  setNumber: Number.parseInt(input.set_number ?? input.setNumber ?? 0, 10),
  setScoreHome: Number.parseInt(input.set_score_home ?? input.setScoreHome ?? 0, 10),
  setScoreOpp: Number.parseInt(input.set_score_opp ?? input.setScoreOpp ?? 0, 10),
  timeoutsHome: input.timeoutsHome ?? 2,
  timeoutsOpp: input.timeoutsOpp ?? 2,
  finalFlag: Boolean(input.finalFlag)
});
globalThis.prepareMatchPayloadForPersistence = (input = {}) => ({
  ...input,
  players: input.players ?? [],
  playersAppeared: input.playersAppeared ?? [],
  jerseys: input.jerseys ?? [],
  jerseysJson: input.jerseysJson ?? '[]',
  whoServedFirst: input.whoServedFirst ?? null
});
globalThis.formatMatchForClient = (row) => row ?? {};

const { MatchState } = await import('./index.js');

class MockStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.params = [];
  }

  bind(...params) {
    this.params = params;
    return this;
  }

  async run() {
    return this.db.execute(this.sql, this.params);
  }

  async all() {
    return this.db.query(this.sql, this.params);
  }
}

class MockDb {
  constructor() {
    this.sets = new Map();
    this.matchScores = new Map();
  }

  prepare(sql) {
    return new MockStatement(this, sql);
  }

  async execute(sql, params) {
    const trimmed = sql.trim();
    if (trimmed.startsWith('INSERT INTO sets')) {
      const [matchId, setNumber, home, opp, finalScoreJson] = params;
      if (!this.sets.has(matchId)) {
        this.sets.set(matchId, new Map());
      }
      const matchSets = this.sets.get(matchId);
      matchSets.set(Number(setNumber), {
        home,
        opp,
        finalScore: parseJsonSafe(finalScoreJson, createEmptyScore())
      });
      return { meta: { changes: 1 } };
    }
    if (trimmed.startsWith('UPDATE matches SET match_score')) {
      const [scoreJson, matchId] = params;
      this.matchScores.set(matchId, scoreJson);
      return { meta: { changes: 1 } };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }

  async query(sql, params) {
    throw new Error(`Unexpected query: ${sql} ${params}`);
  }
}

class MockStorage {
  constructor() {
    this.liveSets = new Map();
    this.matchInfo = new Map();
    this.matches = new Map();
    this.sql = {
      exec: this.exec.bind(this)
    };
  }

  ensureLiveSet(matchId, setNumber) {
    if (!this.liveSets.has(matchId)) {
      this.liveSets.set(matchId, new Map());
    }
    const matchSets = this.liveSets.get(matchId);
    if (!matchSets.has(setNumber)) {
      matchSets.set(setNumber, {
        live_score: JSON.stringify(createEmptyScore()),
        timeouts: JSON.stringify({ home: [false, false], opp: [false, false] }),
        final_flag: false
      });
    }
    return matchSets.get(setNumber);
  }

  async exec(sql, params = []) {
    const trimmed = sql.trim();
    if (trimmed.startsWith('CREATE TABLE')) {
      return { success: true };
    }
    if (trimmed.startsWith('INSERT OR REPLACE INTO live_sets')) {
      const [matchId, setNumber, liveScore, timeouts] = params;
      const record = this.ensureLiveSet(matchId, Number(setNumber));
      record.live_score = liveScore;
      record.timeouts = timeouts;
      record.final_flag = false;
      return { success: true };
    }
    if (trimmed.startsWith('UPDATE live_sets SET final_flag = TRUE')) {
      const [setNumber, matchId] = params;
      const record = this.ensureLiveSet(Number(matchId), Number(setNumber));
      record.final_flag = true;
      return { success: true };
    }
    if (trimmed.startsWith('SELECT live_score FROM live_sets WHERE set_number')) {
      const [setNumber, matchId] = params;
      const matchSets = this.liveSets.get(Number(matchId));
      const record = matchSets?.get(Number(setNumber));
      return { results: record ? [{ live_score: record.live_score }] : [] };
    }
    if (trimmed.startsWith('SELECT live_score FROM live_sets WHERE final_flag = TRUE')) {
      const [matchId] = params;
      const matchSets = this.liveSets.get(Number(matchId));
      const results = [];
      if (matchSets) {
        for (const record of matchSets.values()) {
          if (record.final_flag) {
            results.push({ live_score: record.live_score });
          }
        }
      }
      return { results };
    }
    if (trimmed.startsWith('SELECT id, opponent')) {
      const [id] = params;
      const record = this.matchInfo.get(String(id));
      return { results: record ? [record] : [] };
    }
    if (trimmed.startsWith('INSERT OR REPLACE INTO matches (id')) {
      const [id, opponent, date, time, jerseys, whoServedFirst, playersAppeared, location, type] = params;
      this.matches.set(String(id), {
        id,
        opponent,
        date,
        time,
        jerseys,
        who_served_first: whoServedFirst,
        players_appeared: playersAppeared,
        location,
        type
      });
      return { success: true };
    }
    throw new Error(`Unexpected SQL in storage: ${sql}`);
  }

  async transaction(callback) {
    return callback({ sql: { exec: this.exec.bind(this) } });
  }
}

class MockState {
  constructor(storage) {
    this.storage = storage;
  }

  async blockConcurrencyWhile(callback) {
    await callback();
  }

  getWebSockets() {
    return [];
  }
}

test('finalizing set 1 for two matches keeps results isolated', async () => {
  const storage = new MockStorage();
  const state = new MockState(storage);
  const db = new MockDb();
  const env = { VOLLEYBALL_STATS_DB: db };

  const matchState = new MatchState(state, env);

  const matchOneSets = new Map();
  matchOneSets.set(1, {
    live_score: JSON.stringify({ home: 25, away: 20 }),
    timeouts: JSON.stringify({ home: [false, false], opp: [false, false] }),
    final_flag: false
  });
  storage.liveSets.set(1, matchOneSets);

  const matchTwoSets = new Map();
  matchTwoSets.set(1, {
    live_score: JSON.stringify({ home: 18, away: 25 }),
    timeouts: JSON.stringify({ home: [false, false], opp: [false, false] }),
    final_flag: false
  });
  storage.liveSets.set(2, matchTwoSets);

  storage.matchInfo.set('1', { id: '1', players_appeared: '[]' });
  storage.matchInfo.set('2', { id: '2', players_appeared: '[]' });

  const firstFinalize = await matchState.handleFinalizeSet(storage, '1', { set_number: 1 });
  assert.equal(firstFinalize.status, 200);
  const firstText = await firstFinalize.text();
  assert.equal(firstText, 'Set finalized and persisted');

  assert.equal(storage.liveSets.get(1).get(1).final_flag, true);
  assert.equal(storage.liveSets.get(2).get(1).final_flag, false);
  assert.deepEqual(db.sets.get(1).get(1).finalScore, { home: 25, away: 20 });
  assert.equal(db.matchScores.get(1), JSON.stringify({ home: 1, away: 0 }));

  const secondFinalize = await matchState.handleFinalizeSet(storage, '2', { set_number: 1 });
  assert.equal(secondFinalize.status, 200);
  assert.equal(storage.liveSets.get(2).get(1).final_flag, true);
  assert.deepEqual(db.sets.get(2).get(1).finalScore, { home: 18, away: 25 });
  assert.equal(db.matchScores.get(2), JSON.stringify({ home: 0, away: 1 }));

  assert.equal(db.matchScores.get(1), JSON.stringify({ home: 1, away: 0 }));
});
