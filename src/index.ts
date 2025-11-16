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
        return new Response('Expected Upgrade: websocket', { status: 426 });
      }

      const webSocketPair = new WebSocketPair();
      const [client, server] = Object.values(webSocketPair) as [WebSocket, WebSocket];

      this.state.acceptWebSocket(server);
      if (this.isDebug) console.log(`New WS connection. Total: ${this.state.webSockets?.length ?? 0}`);

      // Test broadcast on connect to verify multi-client
      this.broadcast(JSON.stringify({ type: 'test', msg: 'New connection joined' }));

      // Example: Echo + DB tie-in (e.g., query on connect)
      if (this.isDebug) {
        const cursor = sql.exec('SELECT COUNT(*) FROM matches');
        server.send(`Debug: ${cursor.next().value['COUNT(*)']} matches in DB`);
      }

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
          } else if (request.method === "GET" && action === "get" && id) {
            return matchApi.getMatch(storage, id);
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

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const storage = this.state.storage;
    try {
      const payload = JSON.parse(message as string);
      const resource = Object.keys(payload)[0];
      if (!resource) throw new Error('Invalid payload: missing resource');

      const actionObj = payload[resource];
      const action = Object.keys(actionObj)[0];
      if (!action) throw new Error('Invalid payload: missing action');

      const data = actionObj[action] || {};

      let res: Response;

      switch (resource) {
        case 'match':
          switch (action) {
            case 'create':
              const mockReq = {
                json: async () => data,
              } as Request;
              res = await matchApi.createMatch(storage, mockReq);
              break;
            // ... (all other cases unchanged)
            default:
              throw new Error(`Unknown action for match: ${action}`);
          }
          break;
        // ... (player and set cases unchanged)
      }

      // ... (sender response unchanged)

      // Broadcast if write success
      if (res.status < 300 && action !== 'get') {
        const id = this.getIdFromData(resource, action, data, body);
        if (this.isDebug) console.log(`Write success. Total WS before broadcast: ${this.state.webSockets?.length ?? 0}, ID: ${id}`);
        if (id || (resource === 'set' && action === 'set-is-final' && data.matchId)) {
          let broadcastMsg: string;

          // ... (message preparation unchanged)

          if (this.isDebug) console.log(`Broadcast prepared: ${broadcastMsg.substring(0, 100)}...`);
          this.broadcast(broadcastMsg, ws); // Exclude sender; comment to include for test
        } else if (this.isDebug) {
          console.log('No ID - skipping broadcast');
        }
      } else if (this.isDebug) {
        console.log(`No broadcast: status=${res.status}, action=${action}`);
      }

    } catch (e) {
      // ... (error handling unchanged)
    }
  }

  // ... (webSocketClose, webSocketError, getIdFromData, getUpdated unchanged)

  private broadcast(message: string, exclude?: WebSocket) {
    let sentCount = 0;
    const wsList = this.state.webSockets ?? [];
    for (const conn of wsList) {
      if (conn !== exclude) {
        conn.send(message);
        sentCount++;
      }
    }
    if (this.isDebug) console.log(`Broadcasted to ${sentCount} clients (total: ${wsList.length})`);
  }
}

/* -------------------------------------------------
   Top-level fetch – static files + DO routing
   ------------------------------------------------- */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // ... (unchanged from previous version)
  },
};

function findDurableObjectBinding(env: Record<string, any>): string | null {
  // ... (unchanged)
}