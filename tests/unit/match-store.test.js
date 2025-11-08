import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import { MatchStore } from '../../src/storage/match-store.js';

class ExecOnlySqlStorage {
  constructor(db) {
    this.db = db;
  }

  async exec(statement) {
    const statements = splitStatements(statement);
    let lastResult = emptyResult();
    for (const sql of statements) {
      const trimmed = sql.trim();
      if (!trimmed) continue;
      const upper = trimmed.toUpperCase();
      if (upper.startsWith('BEGIN')) {
        this.db.exec('BEGIN TRANSACTION');
        lastResult = emptyResult();
        continue;
      }
      if (upper.startsWith('COMMIT')) {
        this.db.exec('COMMIT');
        lastResult = emptyResult();
        continue;
      }
      if (upper.startsWith('ROLLBACK')) {
        this.db.exec('ROLLBACK');
        lastResult = emptyResult();
        continue;
      }
      if (upper.startsWith('CREATE TABLE')) {
        this.db.exec(trimmed);
        lastResult = emptyResult();
        continue;
      }

      const statement = this.db.prepare(trimmed);
      if (upper.startsWith('SELECT') || upper.includes(' RETURNING ')) {
        const rows = statement.all();
        const lastRowId = upper.startsWith('INSERT') && rows.length > 0 && rows[0]?.id !== undefined
          ? rows[0].id
          : null;
        lastResult = {
          results: rows,
          lastRowId,
          changes: rows.length,
          duration: 0
        };
      } else {
        const info = statement.run();
        lastResult = {
          results: [],
          lastRowId: info.lastInsertRowid ?? null,
          changes: info.changes ?? 0,
          duration: 0
        };
      }
    }
    return lastResult;
  }
}

class TransactionalSqlStorage {
  constructor(db) {
    this.db = db;
    this.sql = new ExecOnlySqlStorage(db);
    this.transactionCalls = 0;
  }

  async transaction(callback) {
    this.transactionCalls++;
    const txn = {
      sql: () => new ExecOnlySqlStorage(this.db)
    };
    return callback(txn);
  }
}

function splitStatements(sql) {
  return sql
    .split(/;(?=(?:[^']*'[^']*')*[^']*$)/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

function emptyResult() {
  return { results: [], lastRowId: null, changes: 0, duration: 0 };
}

test('creates players using exec-only SQL storage', async () => {
  const db = new Database(':memory:');
  const state = { storage: { sql: new ExecOnlySqlStorage(db) } };
  const store = new MatchStore(state);
  await store.initialized;

  const createResponse = await store.createPlayer({ number: '12', lastName: 'Smith', initial: 'A' });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.equal(created.number, '12');
  assert.equal(created.lastName, 'Smith');

  const updateResponse = await store.updatePlayer({ id: created.id, number: '15', lastName: 'Jones', initial: 'B' });
  assert.equal(updateResponse.status, 200);
  const updated = await updateResponse.json();
  assert.equal(updated.id, created.id);
  assert.equal(updated.number, '15');
  assert.equal(updated.lastName, 'Jones');

  const listResponse = await store.listPlayers();
  const players = await listResponse.json();
  assert.equal(players.length, 1);
  assert.equal(players[0].id, created.id);
  assert.equal(players[0].number, '15');

  const deleteResponse = await store.deletePlayer({ id: created.id });
  assert.equal(deleteResponse.status, 204);

  const emptyList = await store.listPlayers();
  const remaining = await emptyList.json();
  assert.equal(remaining.length, 0);
});

test('creates matches using transactional SQL storage with callable bindings', async () => {
  const db = new Database(':memory:');
  const storage = new TransactionalSqlStorage(db);
  const state = { storage };
  const store = new MatchStore(state);
  await store.initialized;

  const createResponse = await store.createMatch({
    date: '2024-10-01',
    location: 'Main Gym',
    opponent: 'Rivals',
    jerseyColorHome: 'Red',
    jerseyColorOpp: 'Blue',
    resultHome: 25,
    resultOpp: 20,
    firstServer: 'Alice',
    players: ['12', '8'],
    sets: {
      1: {
        home: '25',
        opp: '20',
        timeouts: { home: [false, true], opp: [false, false] }
      }
    },
    finalizedSets: { 1: true },
    isSwapped: false
  });

  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.ok(Number.isInteger(created.id));
  assert.ok(created.id > 0);

  const storedMatch = db.prepare('SELECT location FROM matches WHERE id = ?').get(created.id);
  assert.equal(storedMatch.location, 'Main Gym');

  const setCount = db.prepare('SELECT COUNT(*) AS count FROM match_sets WHERE match_id = ?').get(created.id);
  assert.equal(setCount.count, 5);

  assert.equal(storage.transactionCalls, 1);
});
