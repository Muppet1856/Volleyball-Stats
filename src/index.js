/* 
D1 to store the match info, Opponent, Date, Time, Jerseys, final score by set, who served first, which players appeared in the match, match score, location, type of match.
DO to arbitrate and ensure that the match info row is not written to by multiple clients. The client should update the match info and the DO worker should update the match record.
DO by match for the Live Score by set, Timeouts by set, and the final score flag. The worker should update the final score by set and match score upon marking the set as final.
 */

import { methodNotAllowed, notFound } from './api/responses.js';
import { routeMatchById, routeMatches } from './api/matches.js';
import { routePlayerById, routePlayers } from './api/players.js';

const MATCH_ID_PATTERN = /^\/api\/matches\/(\d+)$/;
const PLAYER_ID_PATTERN = /^\/api\/players\/(\d+)$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const matchId = url.searchParams.get("matchId");  // Assume clients pass matchId

    if (matchId) {
      const doId = env.MATCH_DO.idFromName(matchId);  // Per-match sharding
      const doStub = env.MATCH_DO.get(doId);

      // Proxy client requests to DO (add auth/validation as needed)
      if (url.pathname.startsWith("/live/")) {
        return doStub.fetch(request);  // Forwards to DO's fetch
      }

      // WebSocket proxy for live clients
      if (request.headers.get("Upgrade") === "websocket") {
        return doStub.fetch(new Request("https://do/ws", { headers: request.headers }));
      }
    }

    // Direct D1 reads for archived matches (e.g., list completed)
    if (url.pathname === "/list-matches") {
      const { results } = await env.BINDING_NAME.prepare("SELECT * FROM matches").all();
      return new Response(JSON.stringify(results));
    }

    if (url.pathname.startsWith('/api')) {
      return handleApiRequest(request, env, url.pathname);
    }

    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      return env.ASSETS.fetch(request);
    }

    // Other routes (e.g., assets) as before
    return new Response("Not found", { status: 404 });
  }
};

export class MatchState {
  constructor(state, env) {
    this.state = state;
    this.env = env;
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
    const matchId = url.searchParams.get("matchId");  // Passed from worker
    const storage = this.state.storage;

    if (request.method === "POST") {
      const body = await request.json();

      // Arbitrate match info updates (serialize via DO transaction)
      if (url.pathname === "/update-match-info") {
        await storage.transaction(async (txn) => {
          // Update live match_info in DO storage
          await txn.sql.exec(
            `INSERT OR REPLACE INTO match_info (id, opponent, date, time, jerseys, who_served_first, players_appeared, location, type)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [matchId, body.opponent, body.date, body.time, body.jerseys, body.who_served_first, JSON.stringify(body.players_appeared), body.location, body.type]
          );
          // Optionally sync to D1 immediately (or defer to finalization)
          const d1 = this.env.BINDING_NAME;
          await d1.prepare(
            `INSERT OR REPLACE INTO matches (id, opponent, date, time, jerseys, who_served_first, players_appeared, location, type)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(matchId, body.opponent, body.date, body.time, body.jerseys, body.who_served_first, JSON.stringify(body.players_appeared), body.location, body.type).run();
        });
        return new Response("Match info updated");
      }

      // Live score/timeout updates by set
      if (url.pathname === "/update-live-set") {
        await storage.transaction(async (txn) => {
          await txn.sql.exec(
            `INSERT OR REPLACE INTO live_sets (set_number, live_score, timeouts, final_flag)
             VALUES (?, ?, ?, FALSE)`,
            [body.set_number, JSON.stringify(body.live_score), JSON.stringify(body.timeouts)]
          );
        });
        return new Response("Live set updated");
      }

      // Mark set as final: Compute finals, update D1
      if (url.pathname === "/finalize-set") {
        await storage.transaction(async (txn) => {
          await txn.sql.exec(
            `UPDATE live_sets SET final_flag = TRUE WHERE set_number = ?`,
            [body.set_number]
          );
          // Compute final score by set and overall match score (logic based on your app)
          const finalScore = JSON.parse((await txn.sql.exec(`SELECT live_score FROM live_sets WHERE set_number = ?`, [body.set_number])).results[0].live_score);
          const allSets = await txn.sql.exec(`SELECT live_score FROM live_sets WHERE final_flag = TRUE`).results;
          const matchScore = allSets.reduce((acc, set) => { /* e.g., count wins */ return acc; }, {home: 0, away: 0});

          // Push to D1
          const d1 = this.env.BINDING_NAME;
          await d1.prepare(`INSERT INTO sets (match_id, set_number, final_score) VALUES (?, ?, ?)`)
            .bind(matchId, body.set_number, JSON.stringify(finalScore)).run();
          await d1.prepare(`UPDATE matches SET match_score = ? WHERE id = ?`)
            .bind(JSON.stringify(matchScore), matchId).run();
        });
        return new Response("Set finalized and persisted");
      }
    }

    // GET for querying live state (e.g., for clients)
    if (request.method === "GET" && url.pathname === "/get-live") {
      const data = await storage.sql.exec(`SELECT * FROM live_sets UNION SELECT * FROM match_info WHERE id = ?`, [matchId]).results;
      return new Response(JSON.stringify(data));
    }

    // Optional: WebSocket for real-time broadcasting to clients
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      this.state.acceptWebSocket(pair[1], { matchId });  // Tag for broadcasting
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    return new Response("Invalid request", { status: 400 });
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
