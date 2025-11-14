// src/index.ts
import { initMatchTable, initPlayerTable, initSetTable } from "./utils/init";
import { jsonResponse, errorResponse } from "./utils/responses";  // Add this import

import * as matchApi from "./api/match";
import * as playerApi from "./api/player";
import * as setApi from "./api/set";
import type { DurableObjectNamespace } from '@cloudflare/workers-types';

export interface Env {
  ASSETS: any;
  debug?: string;
  HOME_TEAM?: string;
  // Let the runtime find the DO
}

/* -------------------------------------------------
   Durable Object – holds the SQLite DB
   ------------------------------------------------- */
export class MatchState {
  state: DurableObjectState;
  env: Env;
  isDebug: boolean;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.isDebug = env.debug === "true";

    // Init all tables the first time the DO is created
    const sql = this.state.storage.sql;
    const matchInit = initMatchTable(sql);
    const playerInit = initPlayerTable(sql);
    const setInit = initSetTable(sql);
    if (this.isDebug) {
      console.log(`Match table init: ${matchInit}`);
      console.log(`Player table init: ${playerInit}`);
      console.log(`Set table init: ${setInit}`);
    }
  }

  async fetch(request: Request): Promise<Response> {
    const storage = this.state.storage;
    const sql = storage.sql;
    const url = new URL(request.url);
    const path = url.pathname;

    /* ---------- WebSocket handling (e.g., for live updates) ---------- */
    if (path.startsWith('/ws')) {
      const upgradeHeader = request.headers.get('Upgrade');

      if (upgradeHeader !== 'websocket') {
        // Redirect non-WS traffic away from /ws (e.g., HTTP/HTTPS GETs)
        url.pathname = '/';  // Or '/docs' or external URL
        return Response.redirect(url.toString(), 302);  // Temporary redirect
      }

      if (upgradeHeader !== 'websocket') {
        return errorResponse('Expected Upgrade: websocket', 426);
      }
     
      const webSocketPair = new WebSocketPair();
      const [client, server] = Object.values(webSocketPair);

      server.accept();

      // Example: Echo + DB tie-in (e.g., query on connect)
      if (this.isDebug) {
        const cursor = sql.exec('SELECT COUNT(*) FROM matches');
        server.send(`Debug: ${cursor.next().value['COUNT(*)']} matches in DB`);
      }

      server.addEventListener('message', (event) => {
        server.send(event.data);  // Echo; replace with broadcast or DB ops
      });

      server.addEventListener('close', () => {
        console.log('WS connection closed');
      });

      return new Response(null, { status: 101, webSocket: client });
    }

    /* ---------- /api/* routing ---------- */
    if (path.startsWith("/api/")) {
      const parts = path.slice(5).split("/"); // remove "/api"
      const resource = parts[0];
      const action = parts[1] ?? "";
      const id = parts[2] ? parseInt(parts[2]) : undefined;  // Optional ID for updates/gets

      switch (resource) {
        case "match":
          if (request.method === "POST" && action === "create") {
            return matchApi.createMatch(storage, request);
          } else if (request.method === "POST" && action === "set-location") {
            const body = await request.json();
            return matchApi.setLocation(storage, body.matchId, body.location);
          } else if (request.method === "POST" && action === "set-date-time") {
            const body = await request.json();
            return matchApi.setDateTime(storage, body.matchId, body.date);
          } else if (request.method === "POST" && action === "set-opp-name") {
            const body = await request.json();
            return matchApi.setOppName(storage, body.matchId, body.opponent);
          } else if (request.method === "POST" && action === "set-type") {
            const body = await request.json();
            return matchApi.setType(storage, body.matchId, body.types);
          } else if (request.method === "POST" && action === "set-result") {
            const body = await request.json();
            return matchApi.setResult(storage, body.matchId, body.resultHome, body.resultOpp);
          } else if (request.method === "POST" && action === "set-players") {
            const body = await request.json();
            return matchApi.setPlayers(storage, body.matchId, body.players);
          } else if (request.method === "POST" && action === "set-home-color") {
            const body = await request.json();
            return matchApi.setHomeColor(storage, body.matchId, body.jerseyColorHome);
          } else if (request.method === "POST" && action === "set-opp-color") {
            const body = await request.json();
            return matchApi.setOppColor(storage, body.matchId, body.jerseyColorOpp);
          } else if (request.method === "POST" && action === "set-first-server") {
            const body = await request.json();
            return matchApi.setFirstServer(storage, body.matchId, body.firstServer);
          } else if (request.method === "POST" && action === "set-deleted") {
            const body = await request.json();
            return matchApi.setDeleted(storage, body.matchId, body.deleted);
          } else if (request.method === "GET") {
            return matchApi.getMatches(storage);
          } else if (request.method === "DELETE" && action === "delete" && id) {
            return matchApi.deleteMatch(storage, id);
          }
          break;

        case "player":
          if (request.method === "POST" && action === "create") {
            return playerApi.createPlayer(storage, request);
          } else if (request.method === "POST" && action === "set-lname") {
            const body = await request.json();
            return playerApi.setPlayerLName(storage, body.playerId, body.lastName);
          } else if (request.method === "POST" && action === "set-fname") {
            const body = await request.json();
            return playerApi.setPlayerFName(storage, body.playerId, body.initial);
          } else if (request.method === "POST" && action === "set-number") {
            const body = await request.json();
            return playerApi.setPlayerNumber(storage, body.playerId, body.number);
          } else if (request.method === "GET" && action === "get" && id) {
            return playerApi.getPlayer(storage, id);
          } else if (request.method === "GET") {
            return playerApi.getPlayers(storage);
          } else if (request.method === "DELETE" && action === "delete" && id) {
            return playerApi.deletePlayer(storage, id);
          }
          break;

        case "set":
          if (request.method === "POST" && action === "create") {
            return setApi.createSet(storage, request);
          } else if (request.method === "POST" && action === "set-home-score") {
            const body = await request.json();
            return setApi.setHomeScore(storage, body.setId, body.homeScore);
          } else if (request.method === "POST" && action === "set-opp-score") {
            const body = await request.json();
            return setApi.setOppScore(storage, body.setId, body.oppScore);
          } else if (request.method === "POST" && action === "set-home-timeout") {
            const body = await request.json();
            return setApi.setHomeTimeout(storage, body.setId, body.timeoutNumber, body.value);
          } else if (request.method === "POST" && action === "set-opp-timeout") {
            const body = await request.json();
            return setApi.setOppTimeout(storage, body.setId, body.timeoutNumber, body.value);
          } else if (request.method === "POST" && action === "set-is-final") {
            const body = await request.json();
            return setApi.setIsFinal(storage, body.matchId, body.finalizedSets);
          } else if (request.method === "GET" && action === "get" && id) {
            return setApi.getSet(storage, id);
          } else if (request.method === "GET") {
            const matchIdQuery = url.searchParams.get("matchId");
            const parsedMatchId = matchIdQuery ? parseInt(matchIdQuery, 10) : undefined;
            const matchIdParam = Number.isNaN(parsedMatchId ?? NaN) ? undefined : parsedMatchId;
            return setApi.getSets(storage, matchIdParam);
          } else if (request.method === "DELETE" && action === "delete" && id) {
            return setApi.deleteSet(storage, id);
          }
          break;
      }

      return errorResponse("API endpoint not found", 404);  // Updated with responses.ts
    }

    return errorResponse("Method not allowed", 405);  // Updated with responses.ts
  }
}

/* -------------------------------------------------
   Top-level fetch – static files + DO routing
   ------------------------------------------------- */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {

    const url = new URL(request.url);
    const path = url.pathname;
    
    /* 1. Chrome DevTools probe – silence 500 */
    if (path === "/.well-known/appspecific/com.chrome.devtools.json") {
      return new Response("{}", { headers: { "Content-Type": "application/json" } });
    }

    /* 2. Serve everything from public/ (including / → index.html) */
    let asset: Response | undefined;
    try {
      asset = await env.ASSETS.fetch(request.clone());  // Clone request to preserve body
    } catch (e) {
      if (env.debug === "true") console.log("Assets fetch failed; skipping: " + (e as Error).message);
    }
    if (asset && asset.status < 400) return asset; // 2xx/3xx → file served

    /* 3. Handle /api/config directly (no DB needed) */
    if (path === "/api/config") {
      if (request.method !== "GET") {
        return errorResponse("Method not allowed", 405);
      }
      const homeTeam = env.HOME_TEAM || "Home Team";
      return jsonResponse({ homeTeam });
    }

    /* 4. Route other API requests to the Durable Object (singleton instance) */
    if (path.startsWith("/api/") || path.startsWith("/ws")) {
      const doBindingName = findDurableObjectBinding(env);
      if (!doBindingName) {
        return errorResponse("Durable Object binding not found in env", 500);
      }

      const doId = (env as any)[doBindingName].idFromName("global");
      const doStub = (env as any)[doBindingName].get(doId);
      try {
        return await doStub.fetch(request);
      } catch (e) {
        return errorResponse(`DO fetch failed: ${(e as Error).message}`, 500);
      }
    }

    /* 5. Fallback for unhandled paths */
    return new Response("Not Found", { status: 404 });
  },
};

/**
 * Finds the first key in `env` that is a DurableObjectNamespace.
 * This works because only DO bindings have the `idFromName` method.
 */
function findDurableObjectBinding(env: Record<string, any>): string | null {
  for (const [key, value] of Object.entries(env)) {
    if (value && typeof value === 'object' && typeof (value as any).idFromName === 'function') {
      return key;
    }
  }
  return null;
}