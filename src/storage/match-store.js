import { normalizeMatchPayload } from '../api/matches/utils.js';

const PLAYER_COUNTER_KEY = 'player:nextId';
const MATCH_COUNTER_KEY = 'match:nextId';
const PLAYER_PREFIX = 'player:';
const MATCH_PREFIX = 'match:';

const playerKey = (id) => `${PLAYER_PREFIX}${id}`;
const matchKey = (id) => `${MATCH_PREFIX}${id}`;
const matchSetKey = (id, setNumber) => `${MATCH_PREFIX}${id}:set:${setNumber}`;
const matchFinalizedKey = (id) => `${MATCH_PREFIX}${id}:finalized`;

const createEmptySet = () => ({
  home: '',
  opp: '',
  timeouts: {
    home: [false, false],
    opp: [false, false]
  }
});

export class MatchStore {
  constructor(state, env) {
    this.state = state;
    this.storage = state.storage;
  }

  async fetch(request) {
    if (request.method.toUpperCase() !== 'POST') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: { 'Allow': 'POST' }
      });
    }

    let body;
    try {
      body = await request.json();
    } catch (error) {
      return Response.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    const op = body?.op;
    const payload = body?.payload ?? {};

    switch (op) {
      case 'LIST_PLAYERS':
        return this.listPlayers();
      case 'CREATE_PLAYER':
        return this.createPlayer(payload);
      case 'UPDATE_PLAYER':
        return this.updatePlayer(payload);
      case 'DELETE_PLAYER':
        return this.deletePlayer(payload);
      case 'LIST_MATCHES':
        return this.listMatches();
      case 'GET_MATCH':
        return this.getMatch(payload);
      case 'CREATE_MATCH':
        return this.createMatch(payload);
      case 'UPDATE_MATCH':
        return this.updateMatch(payload);
      case 'DELETE_MATCH':
        return this.deleteMatch(payload);
      default:
        return Response.json({ error: 'Unsupported operation' }, { status: 400 });
    }
  }

  async listPlayers() {
    const stored = await this.storage.list({ prefix: PLAYER_PREFIX });
    const players = [];

    for (const [key, value] of stored.entries()) {
      if (key === PLAYER_COUNTER_KEY) {
        continue;
      }
      if (!value) {
        continue;
      }
      players.push(value);
    }

    players.sort((a, b) => {
      const toNumber = (value) => {
        const parsed = Number.parseInt(value?.number ?? value, 10);
        return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
      };
      const numberDiff = toNumber(a) - toNumber(b);
      if (numberDiff !== 0) {
        return numberDiff;
      }
      const lastNameDiff = (a.lastName ?? '').localeCompare(b.lastName ?? '');
      if (lastNameDiff !== 0) {
        return lastNameDiff;
      }
      return (a.id ?? 0) - (b.id ?? 0);
    });

    return Response.json(players);
  }

  async createPlayer(payload) {
    const number = String(payload?.number ?? '').trim();
    const lastName = String(payload?.lastName ?? '').trim();
    const initial = String(payload?.initial ?? '').trim();

    if (!number || !lastName) {
      return Response.json({ error: 'Player number and last name are required' }, { status: 400 });
    }

    const record = await this.storage.transaction(async (txn) => {
      const nextId = (await txn.get(PLAYER_COUNTER_KEY)) ?? 1;
      const id = nextId;
      await txn.put(PLAYER_COUNTER_KEY, id + 1);
      const player = { id, number, lastName, initial };
      await txn.put(playerKey(id), player);
      return player;
    });

    return Response.json(record, { status: 201 });
  }

  async updatePlayer(payload) {
    const id = Number.parseInt(payload?.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return Response.json({ error: 'Player not found' }, { status: 404 });
    }

    const number = String(payload?.number ?? '').trim();
    const lastName = String(payload?.lastName ?? '').trim();
    const initial = String(payload?.initial ?? '').trim();

    if (!number || !lastName) {
      return Response.json({ error: 'Player number and last name are required' }, { status: 400 });
    }

    const result = await this.storage.transaction(async (txn) => {
      const key = playerKey(id);
      const existing = await txn.get(key);
      if (!existing) {
        return null;
      }
      const updated = { id, number, lastName, initial };
      await txn.put(key, updated);
      return updated;
    });

    if (!result) {
      return Response.json({ error: 'Player not found' }, { status: 404 });
    }

    return Response.json(result);
  }

  async deletePlayer(payload) {
    const id = Number.parseInt(payload?.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return Response.json({ error: 'Player not found' }, { status: 404 });
    }

    const deleted = await this.storage.transaction(async (txn) => {
      const key = playerKey(id);
      const existing = await txn.get(key);
      if (!existing) {
        return false;
      }
      await txn.delete(key);
      return true;
    });

    if (!deleted) {
      return Response.json({ error: 'Player not found' }, { status: 404 });
    }

    return new Response(null, { status: 204 });
  }

  async listMatches() {
    const stored = await this.storage.list({ prefix: MATCH_PREFIX });
    const matches = [];

    for (const [key, value] of stored.entries()) {
      if (!isMatchRecordKey(key) || !value) {
        continue;
      }
      matches.push({
        id: value.id,
        date: value.date ?? '',
        opponent: value.opponent ?? ''
      });
    }

    matches.sort((a, b) => {
      const dateDiff = (a.date ?? '').localeCompare(b.date ?? '');
      if (dateDiff !== 0) {
        return dateDiff;
      }
      const opponentDiff = (a.opponent ?? '').localeCompare(b.opponent ?? '');
      if (opponentDiff !== 0) {
        return opponentDiff;
      }
      return (a.id ?? 0) - (b.id ?? 0);
    });

    return Response.json(matches);
  }

  async getMatch(payload) {
    const id = Number.parseInt(payload?.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return Response.json({ error: 'Match not found' }, { status: 404 });
    }

    const result = await this.storage.transaction(async (txn) => {
      const key = matchKey(id);
      const base = await txn.get(key);
      if (!base) {
        return null;
      }

      const setEntries = await txn.list({ prefix: matchSetPrefix(id) });
      const finalized = (await txn.get(matchFinalizedKey(id))) ?? {};

      return { base, setEntries, finalized };
    });

    if (!result) {
      return Response.json({ error: 'Match not found' }, { status: 404 });
    }

    const { base, setEntries, finalized } = result;
    const sets = hydrateSetsFromEntries(setEntries);
    return Response.json({ ...base, sets, finalizedSets: finalized });
  }

  async createMatch(payload) {
    let normalized;
    try {
      normalized = normalizeMatchPayload(payload);
    } catch (error) {
      return Response.json({ error: 'Invalid match payload' }, { status: 400 });
    }

    const id = await this.storage.transaction(async (txn) => {
      const nextId = (await txn.get(MATCH_COUNTER_KEY)) ?? 1;
      const matchId = nextId;
      await txn.put(MATCH_COUNTER_KEY, matchId + 1);
      await txn.put(matchKey(matchId), createMatchRecord(matchId, normalized));
      await persistMatchSets(txn, matchId, normalized.sets);
      await txn.put(matchFinalizedKey(matchId), normalized.finalizedSets ?? {});
      return matchId;
    });

    return Response.json({ id }, { status: 201 });
  }

  async updateMatch(payload) {
    const id = Number.parseInt(payload?.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return Response.json({ error: 'Match not found' }, { status: 404 });
    }

    let normalized;
    try {
      normalized = normalizeMatchPayload(payload);
    } catch (error) {
      return Response.json({ error: 'Invalid match payload' }, { status: 400 });
    }

    const updated = await this.storage.transaction(async (txn) => {
      const key = matchKey(id);
      const existing = await txn.get(key);
      if (!existing) {
        return false;
      }
      await txn.put(key, createMatchRecord(id, normalized));

      const existingSets = await txn.list({ prefix: matchSetPrefix(id) });
      for (const key of existingSets.keys()) {
        await txn.delete(key);
      }
      await persistMatchSets(txn, id, normalized.sets);
      await txn.put(matchFinalizedKey(id), normalized.finalizedSets ?? {});
      return true;
    });

    if (!updated) {
      return Response.json({ error: 'Match not found' }, { status: 404 });
    }

    return Response.json({ id });
  }

  async deleteMatch(payload) {
    const id = Number.parseInt(payload?.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return Response.json({ error: 'Match not found' }, { status: 404 });
    }

    const deleted = await this.storage.transaction(async (txn) => {
      const key = matchKey(id);
      const existing = await txn.get(key);
      if (!existing) {
        return false;
      }

      await txn.delete(key);
      const setEntries = await txn.list({ prefix: matchSetPrefix(id) });
      for (const setKey of setEntries.keys()) {
        await txn.delete(setKey);
      }
      await txn.delete(matchFinalizedKey(id));
      return true;
    });

    if (!deleted) {
      return Response.json({ error: 'Match not found' }, { status: 404 });
    }

    return new Response(null, { status: 204 });
  }
}

function matchSetPrefix(id) {
  return `${MATCH_PREFIX}${id}:set:`;
}

function persistMatchSets(txn, matchId, sets = {}) {
  const operations = [];
  for (let i = 1; i <= 5; i++) {
    const set = cloneSet(sets[i] ?? sets[String(i)] ?? createEmptySet());
    operations.push(txn.put(matchSetKey(matchId, i), set));
  }
  return Promise.all(operations);
}

function createMatchRecord(id, normalized) {
  return {
    id,
    date: normalized.date ?? '',
    location: normalized.location ?? '',
    types: normalized.types ?? {},
    opponent: normalized.opponent ?? '',
    jerseyColorHome: normalized.jerseyColorHome ?? '',
    jerseyColorOpp: normalized.jerseyColorOpp ?? '',
    resultHome: normalized.resultHome ?? null,
    resultOpp: normalized.resultOpp ?? null,
    firstServer: normalized.firstServer ?? '',
    players: Array.isArray(normalized.players) ? [...normalized.players] : [],
    finalizedSets: normalized.finalizedSets ?? {},
    isSwapped: Boolean(normalized.isSwapped)
  };
}

function hydrateSetsFromEntries(entries = new Map()) {
  const sets = {};
  for (let i = 1; i <= 5; i++) {
    sets[i] = createEmptySet();
  }
  for (const [key, value] of entries.entries()) {
    const segments = key.split(':');
    const setNumber = Number.parseInt(segments[segments.length - 1], 10);
    if (!Number.isInteger(setNumber) || setNumber < 1 || setNumber > 5) {
      continue;
    }
    sets[setNumber] = cloneSet(value ?? createEmptySet());
  }
  return sets;
}

function cloneSet(set) {
  return {
    home: set?.home ?? '',
    opp: set?.opp ?? '',
    timeouts: {
      home: Array.isArray(set?.timeouts?.home)
        ? [...set.timeouts.home].map((value) => Boolean(value))
        : [false, false],
      opp: Array.isArray(set?.timeouts?.opp)
        ? [...set.timeouts.opp].map((value) => Boolean(value))
        : [false, false]
    }
  };
}

function isMatchRecordKey(key) {
  return /^match:\d+$/.test(key);
}
