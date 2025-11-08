import { normalizeMatchPayload } from '../api/matches/utils.js';

const PLAYER_SORT_MAX = Number.POSITIVE_INFINITY;

export class MatchStore {
  constructor(state) {
    this.state = state;
    this.storage = state.storage;
    this.initialized = this.initialize();
  }

  async initialize() {
    await this.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS players (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        number TEXT NOT NULL,
        last_name TEXT NOT NULL,
        initial TEXT NOT NULL DEFAULT ''
      )`
    );

    await this.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL DEFAULT '',
        location TEXT NOT NULL DEFAULT '',
        opponent TEXT NOT NULL DEFAULT '',
        jersey_color_home TEXT NOT NULL DEFAULT '',
        jersey_color_opp TEXT NOT NULL DEFAULT '',
        result_home INTEGER,
        result_opp INTEGER,
        first_server TEXT NOT NULL DEFAULT '',
        players TEXT NOT NULL DEFAULT '[]',
        type_tournament INTEGER NOT NULL DEFAULT 0,
        type_league INTEGER NOT NULL DEFAULT 0,
        type_post_season INTEGER NOT NULL DEFAULT 0,
        type_non_league INTEGER NOT NULL DEFAULT 0,
        finalized_sets TEXT NOT NULL DEFAULT '{}',
        is_swapped INTEGER NOT NULL DEFAULT 0
      )`
    );

    await this.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS match_sets (
        match_id INTEGER NOT NULL,
        set_number INTEGER NOT NULL,
        home TEXT NOT NULL DEFAULT '',
        opp TEXT NOT NULL DEFAULT '',
        timeout_home1 INTEGER NOT NULL DEFAULT 0,
        timeout_home2 INTEGER NOT NULL DEFAULT 0,
        timeout_opp1 INTEGER NOT NULL DEFAULT 0,
        timeout_opp2 INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (match_id, set_number)
      )`
    );
  }

  async fetch(request) {
    await this.initialized;

    if (request.method.toUpperCase() !== 'POST') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: { Allow: 'POST' }
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
    const { results = [] } = await this.storage.sql
      .prepare(
        `SELECT id, number, last_name AS lastName, initial
         FROM players`
      )
      .all();

    const players = results.map((row) => ({
      id: row.id,
      number: row.number ?? '',
      lastName: row.lastName ?? '',
      initial: row.initial ?? ''
    }));

    players.sort((a, b) => {
      const toNumber = (value) => {
        const parsed = Number.parseInt(value?.number ?? value, 10);
        return Number.isNaN(parsed) ? PLAYER_SORT_MAX : parsed;
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
      return Response.json(
        { error: 'Player number and last name are required' },
        { status: 400 }
      );
    }

    const record = await this.storage.sql
      .prepare(
        `INSERT INTO players (number, last_name, initial)
         VALUES (?, ?, ?)
         RETURNING id, number, last_name AS lastName, initial`
      )
      .bind(number, lastName, initial)
      .first();

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
      return Response.json(
        { error: 'Player number and last name are required' },
        { status: 400 }
      );
    }

    const record = await this.storage.sql
      .prepare(
        `UPDATE players
         SET number = ?, last_name = ?, initial = ?
         WHERE id = ?
         RETURNING id, number, last_name AS lastName, initial`
      )
      .bind(number, lastName, initial, id)
      .first();

    if (!record) {
      return Response.json({ error: 'Player not found' }, { status: 404 });
    }

    return Response.json(record);
  }

  async deletePlayer(payload) {
    const id = Number.parseInt(payload?.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return Response.json({ error: 'Player not found' }, { status: 404 });
    }

    const result = await this.storage.sql
      .prepare(`DELETE FROM players WHERE id = ? RETURNING id`)
      .bind(id)
      .first();

    if (!result) {
      return Response.json({ error: 'Player not found' }, { status: 404 });
    }

    return new Response(null, { status: 204 });
  }

  async listMatches() {
    const { results = [] } = await this.storage.sql
      .prepare(
        `SELECT id, date, opponent
         FROM matches
         ORDER BY date, opponent, id`
      )
      .all();

    const matches = results.map((row) => ({
      id: row.id,
      date: row.date ?? '',
      opponent: row.opponent ?? ''
    }));

    return Response.json(matches);
  }

  async getMatch(payload) {
    const id = Number.parseInt(payload?.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return Response.json({ error: 'Match not found' }, { status: 404 });
    }

    const match = await this.storage.sql
      .prepare(
        `SELECT
           id,
           date,
           location,
           opponent,
           jersey_color_home AS jerseyColorHome,
           jersey_color_opp AS jerseyColorOpp,
           result_home AS resultHome,
           result_opp AS resultOpp,
           first_server AS firstServer,
           players,
           type_tournament AS typeTournament,
           type_league AS typeLeague,
           type_post_season AS typePostSeason,
           type_non_league AS typeNonLeague,
           finalized_sets AS finalizedSets,
           is_swapped AS isSwapped
         FROM matches
         WHERE id = ?`
      )
      .bind(id)
      .first();

    if (!match) {
      return Response.json({ error: 'Match not found' }, { status: 404 });
    }

    const { results: setRows = [] } = await this.storage.sql
      .prepare(
        `SELECT
           set_number AS setNumber,
           home,
           opp,
           timeout_home1 AS timeoutHome1,
           timeout_home2 AS timeoutHome2,
           timeout_opp1 AS timeoutOpp1,
           timeout_opp2 AS timeoutOpp2
         FROM match_sets
         WHERE match_id = ?`
      )
      .bind(id)
      .all();

    const sets = hydrateSetsFromRows(setRows);
    const players = parseJsonArray(match.players);
    const finalizedSets = parseJsonObject(match.finalizedSets);

    return Response.json({
      id: match.id,
      date: match.date ?? '',
      location: match.location ?? '',
      types: {
        tournament: toBoolean(match.typeTournament),
        league: toBoolean(match.typeLeague),
        postSeason: toBoolean(match.typePostSeason),
        nonLeague: toBoolean(match.typeNonLeague)
      },
      opponent: match.opponent ?? '',
      jerseyColorHome: match.jerseyColorHome ?? '',
      jerseyColorOpp: match.jerseyColorOpp ?? '',
      resultHome: match.resultHome ?? null,
      resultOpp: match.resultOpp ?? null,
      firstServer: match.firstServer ?? '',
      players,
      sets,
      finalizedSets,
      isSwapped: toBoolean(match.isSwapped)
    });
  }

  async createMatch(payload) {
    let normalized;
    try {
      normalized = normalizeMatchPayload(payload);
    } catch (error) {
      return Response.json({ error: 'Invalid match payload' }, { status: 400 });
    }

    const id = await this.withTransaction(async () => {
      const matchRow = await this.storage.sql
        .prepare(
          `INSERT INTO matches (
             date,
             location,
             opponent,
             jersey_color_home,
             jersey_color_opp,
             result_home,
             result_opp,
             first_server,
             players,
             type_tournament,
             type_league,
             type_post_season,
             type_non_league,
             finalized_sets,
             is_swapped
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           RETURNING id`
        )
        .bind(...createMatchBindings(normalized))
        .first();

      if (!matchRow) {
        throw new Error('Failed to create match');
      }

      await insertMatchSets(this.storage.sql, matchRow.id, normalized.sets);
      return matchRow.id;
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

    const updated = await this.withTransaction(async () => {
      const existing = await this.storage.sql
        .prepare('SELECT id FROM matches WHERE id = ?')
        .bind(id)
        .first();

      if (!existing) {
        return false;
      }

      await this.storage.sql
        .prepare(
          `UPDATE matches
             SET date = ?,
                 location = ?,
                 opponent = ?,
                 jersey_color_home = ?,
                 jersey_color_opp = ?,
                 result_home = ?,
                 result_opp = ?,
                 first_server = ?,
                 players = ?,
                 type_tournament = ?,
                 type_league = ?,
                 type_post_season = ?,
                 type_non_league = ?,
                 finalized_sets = ?,
                 is_swapped = ?
           WHERE id = ?`
        )
        .bind(...createMatchBindings(normalized), id)
        .run();

      await this.storage.sql
        .prepare('DELETE FROM match_sets WHERE match_id = ?')
        .bind(id)
        .run();

      await insertMatchSets(this.storage.sql, id, normalized.sets);
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

    const deleted = await this.withTransaction(async () => {
      const existing = await this.storage.sql
        .prepare('SELECT id FROM matches WHERE id = ?')
        .bind(id)
        .first();

      if (!existing) {
        return false;
      }

      await this.storage.sql
        .prepare('DELETE FROM match_sets WHERE match_id = ?')
        .bind(id)
        .run();

      await this.storage.sql
        .prepare('DELETE FROM matches WHERE id = ?')
        .bind(id)
        .run();

      return true;
    });

    if (!deleted) {
      return Response.json({ error: 'Match not found' }, { status: 404 });
    }

    return new Response(null, { status: 204 });
  }

  async withTransaction(callback) {
    await this.initialized;
    await this.storage.sql.exec('BEGIN TRANSACTION');
    try {
      const result = await callback();
      await this.storage.sql.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        await this.storage.sql.exec('ROLLBACK');
      } catch (rollbackError) {
        // no-op
      }
      throw error;
    }
  }
}

function createMatchBindings(normalized) {
  const playersJson = JSON.stringify(
    Array.isArray(normalized.players) ? [...normalized.players] : []
  );
  const finalizedJson = JSON.stringify(
    normalized.finalizedSets && typeof normalized.finalizedSets === 'object'
      ? normalized.finalizedSets
      : {}
  );

  return [
    normalized.date ?? '',
    normalized.location ?? '',
    normalized.opponent ?? '',
    normalized.jerseyColorHome ?? '',
    normalized.jerseyColorOpp ?? '',
    normalized.resultHome ?? null,
    normalized.resultOpp ?? null,
    normalized.firstServer ?? '',
    playersJson,
    normalized.types?.tournament ? 1 : 0,
    normalized.types?.league ? 1 : 0,
    normalized.types?.postSeason ? 1 : 0,
    normalized.types?.nonLeague ? 1 : 0,
    finalizedJson,
    normalized.isSwapped ? 1 : 0
  ];
}

async function insertMatchSets(database, matchId, sets = {}) {
  for (let i = 1; i <= 5; i++) {
    const set = cloneSet(sets[i] ?? sets[String(i)] ?? createEmptySet());
    await database
      .prepare(
        `INSERT INTO match_sets (
           match_id,
           set_number,
           home,
           opp,
           timeout_home1,
           timeout_home2,
           timeout_opp1,
           timeout_opp2
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        matchId,
        i,
        set.home ?? '',
        set.opp ?? '',
        set.timeouts.home[0] ? 1 : 0,
        set.timeouts.home[1] ? 1 : 0,
        set.timeouts.opp[0] ? 1 : 0,
        set.timeouts.opp[1] ? 1 : 0
      )
      .run();
  }
}

function hydrateSetsFromRows(rows = []) {
  const sets = {};
  for (let i = 1; i <= 5; i++) {
    sets[i] = createEmptySet();
  }

  for (const row of rows) {
    const setNumber = Number.parseInt(row.setNumber, 10);
    if (!Number.isInteger(setNumber) || setNumber < 1 || setNumber > 5) {
      continue;
    }
    sets[setNumber] = {
      home: row.home ?? '',
      opp: row.opp ?? '',
      timeouts: {
        home: [
          toBoolean(row.timeoutHome1),
          toBoolean(row.timeoutHome2)
        ],
        opp: [toBoolean(row.timeoutOpp1), toBoolean(row.timeoutOpp2)]
      }
    };
  }

  return sets;
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value ?? '[]');
    return Array.isArray(parsed) ? parsed.map((entry) => String(entry)) : [];
  } catch (error) {
    return [];
  }
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value ?? '{}');
    return parsed && typeof parsed === 'object' ? { ...parsed } : {};
  } catch (error) {
    return {};
  }
}

function toBoolean(value) {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === 'string') {
    return value !== '0' && value.toLowerCase() !== 'false';
  }
  return Boolean(value);
}

function createEmptySet() {
  return {
    home: '',
    opp: '',
    timeouts: {
      home: [false, false],
      opp: [false, false]
    }
  };
}

function cloneSet(set) {
  return {
    home: set?.home ?? '',
    opp: set?.opp ?? '',
    timeouts: {
      home: Array.isArray(set?.timeouts?.home)
        ? normalizeTimeoutArray(set.timeouts.home)
        : [false, false],
      opp: Array.isArray(set?.timeouts?.opp)
        ? normalizeTimeoutArray(set.timeouts.opp)
        : [false, false]
    }
  };
}

function normalizeTimeoutArray(timeouts = []) {
  const normalized = [false, false];
  for (let i = 0; i < normalized.length; i++) {
    normalized[i] = Boolean(timeouts[i]);
  }
  return normalized;
}
