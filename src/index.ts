// src/index.ts (updated with responses.ts import and usage for non-API routes)
import { initMatchTable, initPlayerTable, initSetTable } from "./utils/init";
import { jsonResponse, errorResponse } from "./utils/responses";  // Add this import

import * as matchApi from "./api/match";
import * as playerApi from "./api/player";
import * as setApi from "./api/set";

export interface Env {
  "Hello-DO": DurableObjectNamespace;
  debug?: string;
}

/* -------------------------------------------------
   Durable Object – holds the SQLite DB
   ------------------------------------------------- */
export class Hello {
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
    const sql = this.state.storage.sql;
    const url = new URL(request.url);
    const path = url.pathname;

    /* ---------- /api/* routing ---------- */
    if (path.startsWith("/api/")) {
      const parts = path.slice(5).split("/"); // remove "/api"
      const resource = parts[0];
      const action = parts[1] ?? "";
      const id = parts[2] ? parseInt(parts[2]) : undefined;  // Optional ID for updates/gets

      switch (resource) {
        case "match":
          if (request.method === "POST" && action === "create") {
            return matchApi.createMatch(sql, request);
          } else if (request.method === "POST" && action === "set-location") {
            const body = await request.json();
            return matchApi.setLocation(sql, body.matchId, body.location);
          } else if (request.method === "POST" && action === "set-date-time") {
            const body = await request.json();
            return matchApi.setDateTime(sql, body.matchId, body.date);
          } else if (request.method === "POST" && action === "set-opp-name") {
            const body = await request.json();
            return matchApi.setOppName(sql, body.matchId, body.opponent);
          } else if (request.method === "POST" && action === "set-type") {
            const body = await request.json();
            return matchApi.setType(sql, body.matchId, body.types);
          } else if (request.method === "POST" && action === "set-result") {
            const body = await request.json();
            return matchApi.setResult(sql, body.matchId, body.resultHome, body.resultOpp);
          } else if (request.method === "POST" && action === "set-players") {
            const body = await request.json();
            return matchApi.setPlayers(sql, body.matchId, body.players);
          } else if (request.method === "POST" && action === "set-home-color") {
            const body = await request.json();
            return matchApi.setHomeColor(sql, body.matchId, body.jerseyColorHome);
          } else if (request.method === "POST" && action === "set-opp-color") {
            const body = await request.json();
            return matchApi.setOppColor(sql, body.matchId, body.jerseyColorOpp);
          } else if (request.method === "POST" && action === "set-first-server") {
            const body = await request.json();
            return matchApi.setFirstServer(sql, body.matchId, body.firstServer);
          } else if (request.method === "GET" && action === "get-sets" && id) {
            return matchApi.getSets(sql, id);
          } else if (request.method === "GET") {
            return matchApi.getMatches(sql);
          }
          break;

        case "player":
          if (request.method === "POST" && action === "create") {
            return playerApi.createPlayer(sql, request);
          } else if (request.method === "POST" && action === "set-lname") {
            const body = await request.json();
            return playerApi.setPlayerLName(sql, body.playerId, body.lastName);
          } else if (request.method === "POST" && action === "set-fname") {
            const body = await request.json();
            return playerApi.setPlayerFName(sql, body.playerId, body.initial);
          } else if (request.method === "POST" && action === "set-number") {
            const body = await request.json();
            return playerApi.setPlayerNumber(sql, body.playerId, body.number);
          } else if (request.method === "GET" && action === "get" && id) {
            return playerApi.getPlayer(sql, id);
          } else if (request.method === "GET") {
            return playerApi.getPlayers(sql);
          }
          break;

        case "set":
          if (request.method === "POST" && action === "create")
            return setApi.createSet(sql, request);
          if (request.method === "GET")
            return setApi.getSets(sql);
          break;
      }

      return errorResponse("API endpoint not found", 404);  // Updated with responses.ts
    }

    /* ---------- Fallback for testing (optional) ---------- */
    if (request.method === "GET") {
      const rows = sql.exec(`SELECT * FROM matches`).toArray();
      if (this.isDebug) console.log("matches:", JSON.stringify(rows));
      return jsonResponse(rows);  // Updated with responses.ts
    }

    return errorResponse("Method not allowed", 405);  // Updated with responses.ts
  }
}

/* -------------------------------------------------
   Top-level fetch – static files + DO routing
   ------------------------------------------------- */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    const path = url.pathname;

    /* 1. Chrome DevTools probe – silence 500 */
    if (path === "/.well-known/appspecific/com.chrome.devtools.json") {
      return new Response("{}", { headers: { "Content-Type": "application/json" } });
    }

    /* 2. Serve everything from public/ (including / → index.html) */
    let asset: Response | undefined;
    try {
      asset = await env.ASSETS.fetch(request);
    } catch (e) {
      if (env.debug === "true") console.log("Assets fetch failed; skipping: " + (e as Error).message);
    }
    if (asset && asset.status < 400) return asset; // 2xx/3xx → file served

    /* 3. Anything else → Durable Object */
    const id = env["Hello-DO"].idFromName("default");
    const stub = env["Hello-DO"].get(id);
    return stub.fetch(request);
  },
};