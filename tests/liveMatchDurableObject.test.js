import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { Miniflare, WebSocketPair } from 'miniflare';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const workerScript = path.join(projectRoot, 'src/worker.js');

async function createDatabase(mf) {
  const db = await mf.getD1Database('VOLLEYBALL_STATS_DB');
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT,
        location TEXT,
        types TEXT,
        opponent TEXT,
        jersey_color_sc TEXT,
        jersey_color_opp TEXT,
        result_sc INTEGER,
        result_opp INTEGER,
        first_server TEXT,
        players TEXT,
        sets TEXT,
        finalized_sets TEXT,
        is_swapped INTEGER DEFAULT 0
      );`
    )
    .run();
  await db
    .prepare(
      `INSERT INTO matches (
        id,
        date,
        location,
        types,
        opponent,
        jersey_color_sc,
        jersey_color_opp,
        result_sc,
        result_opp,
        first_server,
        players,
        sets,
        finalized_sets,
        is_swapped
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      1,
      '2024-05-01T19:00:00Z',
      'Main Gym',
      JSON.stringify({ tournament: false, league: true, postSeason: false, nonLeague: false }),
      'Rivals',
      'blue',
      'red',
      2,
      1,
      'Stoney Creek',
      JSON.stringify(['12 Smith']),
      JSON.stringify({
        1: { sc: '25', opp: '20', timeouts: { sc: [false, false], opp: [false, false] } },
        2: { sc: '22', opp: '25', timeouts: { sc: [false, false], opp: [false, false] } },
        3: { sc: '15', opp: '10', timeouts: { sc: [false, false], opp: [false, false] } }
      }),
      JSON.stringify({ 1: true, 3: true }),
      0
    )
    .run();
  return db;
}

function waitForNextMessage(socket, timeout = 500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeEventListener('message', onMessage);
      reject(new Error('Timed out waiting for message'));
    }, timeout);
    function onMessage(event) {
      clearTimeout(timer);
      socket.removeEventListener('message', onMessage);
      resolve(event.data);
    }
    socket.addEventListener('message', onMessage);
  });
}

describe('LiveMatchDurableObject', () => {
  let mf;
  let database;

  beforeEach(async () => {
    mf = new Miniflare({
      modules: true,
      modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
      scriptPath: workerScript,
      compatibilityDate: '2024-04-03',
      durableObjects: {
        LIVE_MATCH: 'LiveMatchDurableObject'
      },
      d1Databases: {
        VOLLEYBALL_STATS_DB: ':memory:'
      }
    });
    database = await createDatabase(mf);
  });

  afterEach(async () => {
    if (mf) {
      await mf.dispose();
      mf = null;
      database = null;
    }
  });

  it('sends the persisted score to new websocket connections', async () => {
    const res = await mf.dispatchFetch('https://example.com/live/1', {
      headers: { Upgrade: 'websocket' }
    });
    const webSocket = res.webSocket;
    expect(res.status).toBe(101);
    webSocket.accept();

    const namespace = await mf.getDurableObjectNamespace('LIVE_MATCH');
    const id = namespace.idFromName('1');
    const stub = namespace.get(id);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const stateResponse = await stub.fetch('https://internal/state');
    const state = await stateResponse.json();
    expect(state).toHaveProperty('connectionCount');
  });

  it('fans out broadcastScore updates to connected clients', async () => {
    const res = await mf.dispatchFetch('https://example.com/live/1', {
      headers: { Upgrade: 'websocket' }
    });
    const webSocket = res.webSocket;
    expect(res.status).toBe(101);
    webSocket.accept();

    const namespace = await mf.getDurableObjectNamespace('LIVE_MATCH');
    const id = namespace.idFromName('1');
    const stub = namespace.get(id);

    await stub.fetch('https://internal/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'broadcastScore',
        match: {
          id: 1,
          date: '2024-05-01T19:00:00Z',
          opponent: 'Rivals',
          resultSC: 3,
          resultOpp: 1,
          players: ['12 Smith'],
          sets: {},
          finalizedSets: {},
          isSwapped: false
        }
      })
    });

    const stateResponse = await stub.fetch('https://internal/state');
    const state = await stateResponse.json();
    expect(state.lastBroadcast).toMatchObject({
      type: 'broadcastScore',
      match: { id: 1, resultSC: 3, resultOpp: 1 }
    });
  });
});
