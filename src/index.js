import { methodNotAllowed, notFound } from './api/responses.js';
import { routeMatchById, routeMatches } from './api/matches.js';
import { routePlayerById, routePlayers } from './api/players.js';

const MATCH_ID_PATTERN = /^\/api\/matches\/(\d+)$/;
const PLAYER_ID_PATTERN = /^\/api\/players\/(\d+)$/;

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
          set_number INTEGER PRIMARY KEY,
          live_score TEXT,  -- e.g., JSON {home: 25, away: 23}
          timeouts JSON,    -- e.g., {home: 1, away: 0}
          final_flag BOOLEAN DEFAULT FALSE
        );
        CREATE TABLE IF NOT EXISTS match_info (
          id TEXT PRIMARY KEY,  -- Match ID
          opponent TEXT,
          date TEXT,
          time TEXT,
          jerseys TEXT,
          who_served_first TEXT,
          players_appeared JSON,
          match_score TEXT,  -- Updated on finalization
          location TEXT,
          type TEXT
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
      const body = await request.json();
      await storage.transaction(async (txn) => {
        await txn.sql.exec(
          `INSERT OR REPLACE INTO live_sets (set_number, live_score, timeouts, final_flag)
           VALUES (?, ?, ?, FALSE)`,
          [body.set_number, JSON.stringify(body.live_score), JSON.stringify(body.timeouts)]
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

    const jerseysJson = JSON.stringify(payload.jerseys);
    const playersJson = JSON.stringify(payload.playersAppeared);
    const matchScoreJson = JSON.stringify(payload.matchScore);
    let createdId = null;

    try {
      await this.state.storage.transaction(async (txn) => {
        const insertStatement = this.db.prepare(
          `INSERT INTO matches (opponent, date, time, jerseys, who_served_first, players_appeared, location, type, match_score)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          payload.opponent,
          payload.date,
          payload.time,
          jerseysJson,
          payload.whoServedFirst,
          playersJson,
          payload.location,
          payload.type,
          matchScoreJson
        );
        const result = await insertStatement.run();
        createdId = result?.meta?.last_row_id;
        if (!createdId) {
          throw new Error('Match creation failed');
        }
        await txn.sql.exec(
          `INSERT OR REPLACE INTO match_info (id, opponent, date, time, jerseys, who_served_first, players_appeared, match_score, location, type)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            String(createdId),
            payload.opponent,
            payload.date,
            payload.time,
            jerseysJson,
            payload.whoServedFirst,
            playersJson,
            matchScoreJson,
            payload.location,
            payload.type
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

    let identifiers;
    try {
      identifiers = normalizeMatchIdentifier(matchId);
    } catch (error) {
      return Response.json({ error: 'Invalid matchId' }, { status: 400 });
    }

    const jerseysJson = JSON.stringify(payload.jerseys);
    const playersJson = JSON.stringify(payload.playersAppeared);
    const matchScoreJson = JSON.stringify(payload.matchScore);
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
        await txn.sql.exec(`DELETE FROM match_info WHERE id = ?`, [identifiers.text]);
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
          `UPDATE live_sets SET final_flag = TRUE WHERE set_number = ?`,
          [setNumber]
        );

        const { results: finalScoreResults } = await txn.sql.exec(
          `SELECT live_score FROM live_sets WHERE set_number = ?`,
          [setNumber]
        );
        const finalScoreRow = finalScoreResults?.[0];
        const finalScore = parseLiveScore(finalScoreRow?.live_score);

        const { results: finalizedSets } = await txn.sql.exec(
          `SELECT live_score FROM live_sets WHERE final_flag = TRUE`
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
          `INSERT INTO sets (match_id, set_number, final_score) VALUES (?, ?, ?)`
        )
          .bind(identifiers.dbValue, setNumber, JSON.stringify(finalScore))
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
          `INSERT OR REPLACE INTO match_info (id, opponent, date, time, jerseys, who_served_first, players_appeared, location, type)
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
    const [liveSetsResult, matchInfoResult] = await Promise.all([
      storage.sql.exec(
        `SELECT set_number, live_score, timeouts, final_flag FROM live_sets ORDER BY set_number`
      ),
      storage.sql.exec(
        `SELECT id, opponent, date, time, jerseys, who_served_first, players_appeared, match_score, location, type FROM match_info WHERE id = ?`,
        [matchId]
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

  return notFound();
}
