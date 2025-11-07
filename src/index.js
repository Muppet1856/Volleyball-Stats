import { methodNotAllowed, notFound } from './api/responses.js';
import { routeMatchById, routeMatches } from './api/matches.js';
import { routePlayerById, routePlayers } from './api/players.js';
import { routeSetById, routeSets } from './api/sets.js';
import { getDatabase } from './api/database.js';

const MATCH_ID_PATTERN = /^\/api\/matches\/(\d+)$/;
const PLAYER_ID_PATTERN = /^\/api\/players\/(\d+)$/;
const SET_ID_PATTERN = /^\/api\/sets\/(\d+)$/;
const MATCH_TYPE_MIN = 0;
const MATCH_TYPE_MAX = 4;

const normalizeMatchType = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return MATCH_TYPE_MIN;
  }
  if (parsed < MATCH_TYPE_MIN || parsed > MATCH_TYPE_MAX) {
    return MATCH_TYPE_MIN;
  }
  return parsed;
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      return handleApiRequest(request, env, url.pathname);
    }

    return env.ASSETS.fetch(request);
  }
};

export class MatchState {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.db = getDatabase(env);
    this.state.blockConcurrencyWhile(async () => {
      // Initialize storage schema on first access (mirrors D1 tables for live data)
      const storage = this.state.storage;
      await storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS live_sets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          match_id INTEGER NOT NULL,
          set_score_home INTEGER NOT NULL DEFAULT 0,
          set_score_opp INTEGER NOT NULL DEFAULT 0,
          timeouts_home INTEGER NOT NULL DEFAULT 2,
          timeouts_opp INTEGER NOT NULL DEFAULT 2,
          set_number INTEGER NOT NULL,
          live_score TEXT,
          timeouts TEXT,
          final_flag INTEGER NOT NULL DEFAULT 0,
          UNIQUE (match_id, set_number),
          FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS players (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          number INTEGER NOT NULL,
          last_name TEXT NOT NULL,
          initial TEXT DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS matches (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          opponent TEXT,
          date TEXT,
          time TEXT,
          jersey_home INTEGER,
          jersey_opp INTEGER,
          first_server INTEGER,
          players_appeared TEXT,
          result_home INTEGER,
          result_opp INTEGER,
          location TEXT,
          type INTEGER
        );

      `);  // Use SQLite API (enable via compatibility_flags if needed)
    });
  }
 
  async fetch(request) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method.toUpperCase();
    const matchId = url.searchParams.get('matchId');
    const storage = this.state.storage;

    if (pathname === '/create-match' && method === 'POST') {
      return this.handleCreateMatch(request);
    }

    if (!matchId) {
      return Response.json({ error: 'matchId query parameter is required' }, { status: 400 });
    }

    if (pathname === '/update-match-info' && (method === 'POST' || method === 'PUT')) {
      return this.handleUpsertMatch(request, matchId);
    }

    if (pathname === '/delete-match' && method === 'DELETE') {
      return this.handleDeleteMatch(matchId);
    }

    if (pathname === '/get-match' && method === 'GET') {
      return this.handleGetMatch(matchId);
    }

    if (pathname === '/update-live-set' && method === 'POST') {
      let identifiers;
      try {
        identifiers = normalizeMatchIdentifier(matchId);
      } catch (error) {
        return Response.json({ error: 'Invalid matchId' }, { status: 400 });
      }

      const body = await request.json();
      await storage.transaction(async (txn) => {
        await txn.sql.exec(
          `INSERT OR REPLACE INTO live_sets (match_id, set_number, live_score, timeouts, final_flag)
           VALUES (?, ?, ?, ?, FALSE)`,
          [
            identifiers.dbValue,
            body.set_number,
            JSON.stringify(body.live_score),
            JSON.stringify(body.timeouts)
          ]
        );
      });
      return new Response('Live set updated');
    }

    if (pathname === '/finalize-set' && method === 'POST') {
      const body = await request.json();
      return this.handleFinalizeSet(storage, matchId, body);
    }

    if (method === 'GET' && pathname === '/get-live') {
      return this.handleGetLive(storage, matchId);
    }

    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      this.state.acceptWebSocket(pair[1], { matchId });
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    return new Response('Invalid request', { status: 400 });
  }

  async handleCreateSet(request) {
    let rawBody;
    try {
      rawBody = await request.json();
    } catch (error) {
      return Response.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    let payload;
    try {
      payload = prepareSetPayloadForPersistence(rawBody);
    } catch (error) {
      console.error('Failed to normalize set payload', error);
      return Response.json({ error: 'Invalid set payload' }, { status: 400 });
    }

    let createdId = null;
    let replicated = false;

    try {
      const insertStatement = this.db.prepare(
        `INSERT INTO sets (
          match_id,
          set_number,
          set_score_home,
          set_score_opp
        ) VALUES (?, ?, ?, ?)`
      ).bind(
        payload.matchID,
        payload.setNumber,
        payload.setScoreHome,
        payload.setScoreOpp
      );

      const insertResult = await insertStatement.run();
      createdId = insertResult?.meta?.last_row_id;
      if (!createdId) {
        throw new Error('Set creation failed');
      }

      await this.state.storage.transaction(async (txn) => {
        const replicationResult = await txn.sql.exec(
          `INSERT OR REPLACE INTO live_sets (
            id,
            match_id,
            set_number,
            set_score_home,
            set_score_opp,
            timeouts_home,
            timeouts_opp,
            final_flag
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            String(createdId),
            payload.matchID,
            payload.setNumber,
            payload.setScoreHome,
            payload.setScoreOpp,
            payload.timeoutsHome,
            payload.timeoutsOpp,
            payload.finalFlag
          ]
        );

        if (replicationResult?.success === false) {
          throw new Error('Failed to replicate set to Durable Object storage');
        }
      });

      replicated = true;
    } catch (error) {
      if (createdId && !replicated) {
        try {
          await this.db.prepare('DELETE FROM sets WHERE id = ?')
            .bind(createdId)
            .run();
        } catch (rollbackError) {
          console.error('Failed to rollback set after Durable Object replication failure', rollbackError);
        }
      }

      console.error('Failed to create set via DO', error);
      return Response.json({ error: 'Failed to create set' }, { status: 500 });
    }

    return Response.json({ id: createdId }, { status: 201 });
  }

  async handleCreateMatch(request) {
    let rawBody;
    try {
      rawBody = await request.json();
    } catch (error) {
      return Response.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    let payload;
    try {
      payload = prepareMatchPayloadForPersistence(rawBody);
    } catch (error) {
      console.error('Failed to normalize match payload', error);
      return Response.json({ error: 'Invalid match payload' }, { status: 400 });
    }

    payload.type = normalizeMatchType(payload.type);

    let createdId = null;

    try {
      await this.state.storage.transaction(async (txn) => {
        const insertStatement = this.db.prepare(
          `INSERT INTO matches (
            date,
            time,
            location,
            type,
            opponent,
            jersey_home,
            jersey_opp,
            result_home,
            result_opp,
            first_server,
            players_appeared
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          payload.date,
          payload.time,
          payload.location,
          payload.type,
          payload.opponent,
          payload.jerseyColorHome,
          payload.jerseyColorOpp,
          payload.resultHome,
          payload.resultOpp,
          payload.firstServer,
          JSON.stringify(payload.players)
        );
        const result = await insertStatement.run();
        createdId = result?.meta?.last_row_id;
        if (!createdId) {
          throw new Error('Match creation failed');
        }
        await txn.sql.exec(
          `INSERT OR REPLACE INTO matches (id, date, time, location, type, opponent, jersey_home, jersey_opp, result_home, result_opp, first_server, players_appeared)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            String(createdId),
            payload.date,
            payload.time,
            payload.location,
            payload.type,
            payload.opponent,
            payload.jerseyColorHome,
            payload.jerseyColorOpp,
            payload.resultHome,
            payload.resultOpp,
            payload.firstServer,
            JSON.stringify(payload.players)
          ]
        );
      });
    } catch (error) {
      console.error('Failed to create match via DO', error);
      return Response.json({ error: 'Failed to create match' }, { status: 500 });
    }
    return Response.json({ id: createdId }, { status: 201 });
  }

  async handleUpsertMatch(request, matchId) {
    let rawBody;
    try {
      rawBody = await request.json();
    } catch (error) {
      return Response.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    let payload;
    try {
      payload = prepareMatchPayloadForPersistence(rawBody);
    } catch (error) {
      console.error('Failed to normalize match payload', error);
      return Response.json({ error: 'Invalid match payload' }, { status: 400 });
    }

    payload.type = normalizeMatchType(payload.type);

    let identifiers;
    try {
      identifiers = normalizeMatchIdentifier(matchId);
    } catch (error) {
      return Response.json({ error: 'Invalid matchId' }, { status: 400 });
    }

    const jerseysJson = JSON.stringify(payload.jerseys);
    const playersJson = JSON.stringify(payload.playersAppeared);
    const storedJerseys =
      typeof rawBody?.jerseys === 'string' && rawBody.jerseys.trim().length > 0
        ? rawBody.jerseys
        : jerseysJson;

    try {
      await this.state.storage.transaction(async (txn) => {
        await txn.sql.exec(
          `INSERT OR REPLACE INTO match_info (id, opponent, date, time, jerseys, who_served_first, players_appeared, location, type)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            identifiers.text,
            payload.opponent,
            payload.date,
            payload.time,
            storedJerseys,
            payload.whoServedFirst,
            playersJson,
            payload.location,
            payload.type
          ]
        );

        await this.db.prepare(
          `INSERT OR REPLACE INTO matches (id, opponent, date, time, jerseys, who_served_first, players_appeared, location, type)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(
            identifiers.dbValue,
            payload.opponent,
            payload.date,
            payload.time,
            jerseysJson,
            payload.whoServedFirst,
            playersJson,
            payload.location,
            payload.type
          )
          .run();

        await this.db.prepare(
          `UPDATE matches SET match_score = ? WHERE id = ?`
        )
          .bind(matchScoreJson, identifiers.dbValue)
          .run();
      });
    } catch (error) {
      console.error('Failed to update match via DO', error);
      return Response.json({ error: 'Failed to update match' }, { status: 500 });
    }

    const responseId = identifiers.numeric ?? identifiers.text;
    return Response.json({ id: responseId });
  }

  async handleDeleteMatch(matchId) {
    let identifiers;
    try {
      identifiers = normalizeMatchIdentifier(matchId);
    } catch (error) {
      return Response.json({ error: 'Invalid matchId' }, { status: 400 });
    }

    let deleted = false;
    try {
      await this.state.storage.transaction(async (txn) => {
        await txn.sql.exec(`DELETE FROM matches WHERE id = ?`, [identifiers.text]);
        const result = await this.db.prepare('DELETE FROM matches WHERE id = ?')
          .bind(identifiers.dbValue)
          .run();
        deleted = Boolean(result?.meta && result.meta.changes > 0);
        if (deleted) {
          await this.db.prepare('DELETE FROM sets WHERE match_id = ?')
            .bind(identifiers.dbValue)
            .run();
        }
      });
    } catch (error) {
      console.error('Failed to delete match via DO', error);
      return Response.json({ error: 'Failed to delete match' }, { status: 500 });
    }

    if (!deleted) {
      return Response.json({ error: 'Match not found' }, { status: 404 });
    }

    return new Response(null, { status: 204 });
  }

  async handleGetMatch(matchId) {
    let identifiers;
    try {
      identifiers = normalizeMatchIdentifier(matchId);
    } catch (error) {
      return Response.json({ error: 'Invalid matchId' }, { status: 400 });
    }

    try {
      const matchStatement = this.db.prepare('SELECT * FROM matches WHERE id = ?')
        .bind(identifiers.dbValue);
      const { results: matchResults } = await matchStatement.all();
      const row = matchResults?.[0];
      if (!row) {
        return Response.json({ error: 'Match not found' }, { status: 404 });
      }

      const { results: setRows = [] } = await this.db.prepare(
        'SELECT set_number, final_score FROM sets WHERE match_id = ? ORDER BY set_number'
      )
        .bind(identifiers.dbValue)
        .all();

      const match = formatMatchForClient(row, setRows ?? []);
    return Response.json(match);
    } catch (error) {
      console.error('Failed to fetch match via DO', error);
      return Response.json({ error: 'Failed to fetch match' }, { status: 500 });
    }
  }

  async handleFinalizeSet(storage, matchId, body) {
    let identifiers;
    try {
      identifiers = normalizeMatchIdentifier(matchId);
    } catch (error) {
      return Response.json({ error: 'Invalid matchId' }, { status: 400 });
    }

    const setNumber = Number.parseInt(body?.set_number, 10);
    if (Number.isNaN(setNumber)) {
      return Response.json({ error: 'Invalid set number' }, { status: 400 });
    }

    try {
      await storage.transaction(async (txn) => {
        await txn.sql.exec(
          `UPDATE live_sets SET final_flag = TRUE WHERE set_number = ? AND match_id = ?`,
          [setNumber, identifiers.dbValue]
        );

        const { results: finalScoreResults } = await txn.sql.exec(
          `SELECT live_score FROM live_sets WHERE set_number = ? AND match_id = ?`,
          [setNumber, identifiers.dbValue]
        );
        const finalScoreRow = finalScoreResults?.[0];
        const finalScore = parseLiveScore(finalScoreRow?.live_score);

        const { results: finalizedSets } = await txn.sql.exec(
          `SELECT live_score FROM live_sets WHERE final_flag = TRUE AND match_id = ?`,
          [identifiers.dbValue]
        );
        const matchScore = (finalizedSets ?? []).reduce((acc, set) => {
          const parsedScore = parseLiveScore(set.live_score);
          if (parsedScore.home > parsedScore.away) {
            acc.home += 1;
          } else if (parsedScore.away > parsedScore.home) {
            acc.away += 1;
          }
          return acc;
        }, createEmptyScore());

        await this.db.prepare(
          `INSERT INTO sets (match_id, set_number, set_score_home, set_score_opp, final_score)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(match_id, set_number)
           DO UPDATE SET
             set_score_home = excluded.set_score_home,
             set_score_opp = excluded.set_score_opp,
             final_score = excluded.final_score`
        )
          .bind(
            identifiers.dbValue,
            setNumber,
            finalScore.home,
            finalScore.away,
            JSON.stringify(finalScore)
          )
          .run();

        await this.db.prepare(
          `UPDATE matches SET match_score = ? WHERE id = ?`
        )
          .bind(JSON.stringify(matchScore), identifiers.dbValue)
          .run();

        const existingInfoResult = await txn.sql.exec(
          `SELECT id, opponent, date, time, jerseys, who_served_first, players_appeared, match_score, location, type FROM match_info WHERE id = ?`,
          [identifiers.text]
        );
        const existingInfo = existingInfoResult?.results?.[0] ?? {};
        await txn.sql.exec(
          `INSERT OR REPLACE INTO matches (id, opponent, date, time, jerseys, who_served_first, players_appeared, location, type)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            identifiers.text,
            existingInfo.opponent ?? null,
            existingInfo.date ?? null,
            existingInfo.time ?? null,
            existingInfo.jerseys ?? null,
            existingInfo.who_served_first ?? null,
            existingInfo.players_appeared ?? JSON.stringify([]),
            existingInfo.location ?? null,
            existingInfo.type ?? null
          ]
        );
      });
    } catch (error) {
      console.error('Failed to finalize set via DO', error);
      return Response.json({ error: 'Failed to finalize set' }, { status: 500 });
    }

    return new Response('Set finalized and persisted');
  }

  async handleGetLive(storage, matchId) {
    let identifiers;
    try {
      identifiers = normalizeMatchIdentifier(matchId);
    } catch (error) {
      return Response.json({ error: 'Invalid matchId' }, { status: 400 });
    }

    const [liveSetsResult, matchInfoResult] = await Promise.all([
      storage.sql.exec(
        `SELECT set_number, live_score, timeouts, final_flag FROM live_sets WHERE match_id = ? ORDER BY set_number`,
        [identifiers.dbValue]
      ),
      storage.sql.exec(
        `SELECT id, opponent, date, time, jerseys, who_served_first, players_appeared, match_score, location, type FROM match_info WHERE id = ?`,
        [identifiers.text]
      )
    ]);

    const liveSets = (liveSetsResult?.results ?? []).map((row) => {
      const setNumber = Number.parseInt(row.set_number, 10);
      return {
        setNumber: Number.isNaN(setNumber) ? null : setNumber,
        liveScore: parseLiveScore(row.live_score),
        timeouts: parseTimeouts(row.timeouts),
        final: Boolean(row.final_flag)
      };
    });

    const matchInfoRow = (matchInfoResult?.results ?? [])[0] ?? null;
    const matchInfo = matchInfoRow
      ? {
          id: matchInfoRow.id ?? null,
          opponent: matchInfoRow.opponent ?? null,
          date: matchInfoRow.date ?? null,
          time: matchInfoRow.time ?? null,
          jerseys: matchInfoRow.jerseys ?? null,
          whoServedFirst: matchInfoRow.who_served_first ?? null,
          playersAppeared: parseJsonField(matchInfoRow.players_appeared, []),
          matchScore: parseLiveScore(matchInfoRow.match_score),
          location: matchInfoRow.location ?? null,
          type: matchInfoRow.type ?? null
        }
      : null;

    return new Response(
      JSON.stringify({ matchInfo, liveSets }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Optional: Broadcast updates to connected WebSockets
  webSocketMessage(ws, message) {
    // Parse message, broadcast to others with same tag
    this.state.getWebSockets({ matchId: ws.tag.matchId }).forEach(otherWs => otherWs.send(message));
  }

}

function handleApiRequest(request, env, pathname) {
  if (pathname === '/api/matches') {
    return routeMatches(request, env);
  }

  if (pathname === '/api/config') {
    if (request.method.toUpperCase() !== 'GET') {
      return methodNotAllowed(['GET']);
    }
    const homeTeam = (env?.HOME_TEAM ?? 'Home Team').toString();
    return Response.json({ homeTeam });
  }

  const matchId = pathname.match(MATCH_ID_PATTERN);
  if (matchId) {
    return routeMatchById(request, env, Number.parseInt(matchId[1], 10));
  }

  if (pathname === '/api/players') {
    return routePlayers(request, env);
  }

  const playerId = pathname.match(PLAYER_ID_PATTERN);
  if (playerId) {
    return routePlayerById(request, env, Number.parseInt(playerId[1], 10));
  }

  if (pathname === '/api/sets') {
    return routeSets(request, env);
  }

  const setId = pathname.set(SET_ID_PATTERN);
  if (setId) {
    return routeSetById(request, env, Number.parseInt(setId[1], 10));
  }

  return notFound();
}
