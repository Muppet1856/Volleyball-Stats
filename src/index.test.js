import test from 'node:test';
import assert from 'node:assert/strict';

import worker, { MatchState } from './index.js';

class FakeStorage {
  constructor() {
    this.liveSets = new Map();
    this.matchInfo = new Map();
    this.sql = {
      exec: async (query, params = []) => this.#exec(query, params)
    };
  }

  async transaction(callback) {
    const txn = {
      sql: {
        exec: async (query, params = []) => this.#exec(query, params)
      }
    };
    return callback(txn);
  }

  async #exec(query, params) {
    const trimmed = query.trim();

    if (trimmed.startsWith('CREATE TABLE')) {
      return { results: [] };
    }

    if (trimmed.startsWith('INSERT OR REPLACE INTO live_sets')) {
      const [setNumber, liveScore, timeouts] = params;
      this.liveSets.set(setNumber, {
        set_number: setNumber,
        live_score: liveScore,
        timeouts,
        final_flag: false
      });
      return { results: [] };
    }

    if (trimmed.startsWith('INSERT OR REPLACE INTO match_info')) {
      const [
        id,
        opponent,
        date,
        time,
        jerseys,
        whoServedFirst,
        playersAppeared,
        location,
        type
      ] = params;

      this.matchInfo.set(id, {
        id,
        opponent,
        date,
        time,
        jerseys,
        who_served_first: whoServedFirst,
        players_appeared: playersAppeared,
        match_score: null,
        location,
        type
      });
      return { results: [] };
    }

    if (trimmed.startsWith('UPDATE live_sets SET final_flag = TRUE')) {
      const [setNumber] = params;
      const existing = this.liveSets.get(setNumber);
      if (existing) {
        existing.final_flag = true;
      }
      return { results: [] };
    }

    if (trimmed.startsWith('SELECT live_score FROM live_sets WHERE set_number = ?')) {
      const [setNumber] = params;
      const row = this.liveSets.get(setNumber);
      return { results: row ? [{ live_score: row.live_score }] : [] };
    }

    if (trimmed.startsWith('SELECT live_score FROM live_sets WHERE final_flag = TRUE')) {
      const results = [];
      for (const row of this.liveSets.values()) {
        if (row.final_flag) {
          results.push({ live_score: row.live_score });
        }
      }
      return { results };
    }

    if (trimmed.startsWith('SELECT set_number, live_score, timeouts, final_flag FROM live_sets')) {
      const results = Array.from(this.liveSets.values()).map((row) => ({ ...row }));
      results.sort((a, b) => a.set_number - b.set_number);
      return { results };
    }

    if (
      trimmed.startsWith(
        'SELECT id, opponent, date, time, jerseys, who_served_first, players_appeared, match_score, location, type FROM match_info WHERE id = ?'
      )
    ) {
      const [id] = params;
      const row = this.matchInfo.get(id);
      return { results: row ? [{ ...row }] : [] };
    }

    throw new Error(`Unhandled query: ${query}`);
  }
}

class FakeDurableObjectState {
  constructor(storage) {
    this.storage = storage;
  }

  async blockConcurrencyWhile(callback) {
    await callback();
  }

  acceptWebSocket() {}

  getWebSockets() {
    return [];
  }
}

class FakeDatabase {
  constructor() {
    this.matchScoreUpdates = [];
  }

  prepare(query) {
    if (query.startsWith('INSERT INTO sets')) {
      return {
        bind: (matchId, setNumber, finalScore) => ({
          run: async () => {
            this.lastSetInsert = { matchId, setNumber, finalScore };
            return { meta: { changes: 1 } };
          }
        })
      };
    }

    if (query.startsWith('INSERT OR REPLACE INTO matches')) {
      return {
        bind: (
          id,
          opponent,
          date,
          time,
          jerseys,
          whoServedFirst,
          playersAppeared,
          location,
          type
        ) => ({
          run: async () => {
            this.lastMatchUpsert = {
              id,
              opponent,
              date,
              time,
              jerseys,
              whoServedFirst,
              playersAppeared,
              location,
              type
            };
            return { meta: { changes: 1 } };
          }
        })
      };
    }

    if (query.startsWith('UPDATE matches SET match_score = ? WHERE id = ?')) {
      return {
        bind: (matchScore, id) => ({
          run: async () => {
            this.matchScoreUpdates.push({ matchScore, id });
            return { meta: { changes: 1 } };
          }
        })
      };
    }

    throw new Error(`Unhandled query: ${query}`);
  }
}

test('GET /api/matches is handled by handleApiRequest', async () => {
  const request = new Request('https://example.com/api/matches');
  const env = {
    VOLLEYBALL_STATS_DB: {
      prepare() {
        return {
          async all() {
            return { results: [] };
          }
        };
      }
    }
  };

  const response = await worker.fetch(request, env);

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, []);
});

test('finalizing sets persists aggregated match score', async () => {
  const matchId = 'match-123';
  const storage = new FakeStorage();
  const state = new FakeDurableObjectState(storage);
  const db = new FakeDatabase();

  const matchState = new MatchState(state, { VOLLEYBALL_STATS_DB: db });

  const updateLiveSet = (setNumber, liveScore) =>
    matchState.fetch(
      new Request(`https://example.com/update-live-set?matchId=${matchId}`, {
        method: 'POST',
        body: JSON.stringify({
          set_number: setNumber,
          live_score: liveScore,
          timeouts: {}
        })
      })
    );

  const finalizeSet = (setNumber) =>
    matchState.fetch(
      new Request(`https://example.com/finalize-set?matchId=${matchId}`, {
        method: 'POST',
        body: JSON.stringify({ set_number: setNumber })
      })
    );

  await updateLiveSet(1, { home: 25, away: 20 });
  await finalizeSet(1);

  await updateLiveSet(2, { home: 18, away: 25 });
  await finalizeSet(2);

  await updateLiveSet(3, { home: 15, away: 13 });
  await finalizeSet(3);

  assert.equal(db.matchScoreUpdates.length, 3);
  const lastUpdate = db.matchScoreUpdates[db.matchScoreUpdates.length - 1];
  assert.equal(lastUpdate.id, matchId);
  assert.deepEqual(JSON.parse(lastUpdate.matchScore), { home: 2, away: 1 });
});

test('GET /get-live returns live sets and match info', async () => {
  const matchId = 'live-789';
  const storage = new FakeStorage();
  const state = new FakeDurableObjectState(storage);
  const db = new FakeDatabase();

  const matchState = new MatchState(state, { VOLLEYBALL_STATS_DB: db });

  const postHeaders = { 'Content-Type': 'application/json' };

  await matchState.fetch(
    new Request(`https://example.com/update-match-info?matchId=${matchId}`, {
      method: 'POST',
      headers: postHeaders,
      body: JSON.stringify({
        opponent: 'Rivals',
        date: '2024-04-12',
        time: '18:00',
        jerseys: 'Blue/White',
        who_served_first: 'Home',
        players_appeared: ['12', '34'],
        location: 'Home Gym',
        type: 'League'
      })
    })
  );

  await matchState.fetch(
    new Request(`https://example.com/update-live-set?matchId=${matchId}`, {
      method: 'POST',
      headers: postHeaders,
      body: JSON.stringify({
        set_number: 1,
        live_score: { home: 10, away: 8 },
        timeouts: { sc: [true, false], opp: [false, false] }
      })
    })
  );

  const response = await matchState.fetch(
    new Request(`https://example.com/get-live?matchId=${matchId}`)
  );

  assert.equal(response.status, 200);
  const body = await response.json();

  assert.deepEqual(body, {
    matchInfo: {
      id: matchId,
      opponent: 'Rivals',
      date: '2024-04-12',
      time: '18:00',
      jerseys: 'Blue/White',
      whoServedFirst: 'Home',
      playersAppeared: ['12', '34'],
      matchScore: { home: 0, away: 0 },
      location: 'Home Gym',
      type: 'League'
    },
    liveSets: [
      {
        setNumber: 1,
        liveScore: { home: 10, away: 8 },
        timeouts: { sc: [true, false], opp: [false, false] },
        final: false
      }
    ]
  });
});
