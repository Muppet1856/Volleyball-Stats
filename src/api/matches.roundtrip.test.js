import test from 'node:test';
import assert from 'node:assert/strict';

import { routeMatches, routeMatchById } from './matches.js';

class FakeStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.args = [];
  }

  bind(...args) {
    this.args = args;
    this.db.calls.push({ sql: this.sql, args });
    return this;
  }

  async run() {
    return this.db.runResults.shift() ?? { meta: { changes: 1 } };
  }

  async all() {
    return this.db.allResults.shift() ?? { results: [] };
  }
}

class FakeDb {
  constructor() {
    this.calls = [];
    this.runResults = [];
    this.allResults = [];
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }
}

const createJsonRequest = (url, method, body) =>
  new Request(url, {
    method,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' }
  });

test('create match persists numeric type values', async () => {
  const db = new FakeDb();
  db.runResults.push({ meta: { last_row_id: 42 } });
  const env = { VOLLEYBALL_STATS_DB: db };
  const request = createJsonRequest('https://example.com/api/matches', 'POST', {
    type: '4',
    players: ['12']
  });

  const response = await routeMatches(request, env);
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.id, 42);
  assert.equal(db.calls.length, 1);
  assert.equal(db.calls[0].args[3], 4);
});

test('update match binds numeric type to statement', async () => {
  const db = new FakeDb();
  db.runResults.push({ meta: { changes: 1 } });
  const env = { VOLLEYBALL_STATS_DB: db };
  const request = createJsonRequest('https://example.com/api/matches/7', 'PUT', {
    type: 2
  });

  const response = await routeMatchById(request, env, 7);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.id, 7);
  assert.equal(db.calls.length, 1);
  assert.equal(db.calls[0].args[3], 2);
});

test('get match returns integer type field', async () => {
  const db = new FakeDb();
  db.allResults.push({
    results: [
      {
        id: 9,
        date: '2024-05-01T12:00:00Z',
        location: 'Home',
        type: '3',
        opponent: 'Rivals',
        jersey_color_home: 'blue',
        jersey_color_opp: 'white',
        result_home: 3,
        result_opp: 2,
        first_server: 'home',
        players: JSON.stringify([]),
        sets: JSON.stringify({}),
        finalized_sets: JSON.stringify({}),
        is_swapped: 0
      }
    ]
  });
  const env = { VOLLEYBALL_STATS_DB: db };
  const request = new Request('https://example.com/api/matches/9', { method: 'GET' });

  const response = await routeMatchById(request, env, 9);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.type, 3);
});
