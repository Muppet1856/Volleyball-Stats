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

  async webSocketOpen(ws: WebSocket) {
    if (this.isDebug) {
      const sql = this.state.storage.sql;
      const cursor = sql.exec('SELECT COUNT(*) FROM matches');
      ws.send(`Debug: ${cursor.next().value['COUNT(*)']} matches in DB`);
    }
  }

  async fetch(request: Request): Promise<Response> {
    const storage = this.state.storage;
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

  // Handle WebSocket messages (dispatched by runtime after acceptWebSocket)
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
              // Mock Request for create
              const mockReq = {
                json: async () => data,
              } as Request;
              res = await matchApi.createMatch(storage, mockReq);
              break;
            case 'set-location':
              res = await matchApi.setLocation(storage, data.matchId, data.location);
              break;
            case 'set-date-time':
              res = await matchApi.setDateTime(storage, data.matchId, data.date);
              break;
            case 'set-opp-name':
              res = await matchApi.setOppName(storage, data.matchId, data.opponent);
              break;
            case 'set-type':
              res = await matchApi.setType(storage, data.matchId, data.types);
              break;
            case 'set-result':
              res = await matchApi.setResult(storage, data.matchId, data.resultHome, data.resultOpp);
              break;
            case 'set-players':
              res = await matchApi.setPlayers(storage, data.matchId, data.players);
              break;
            case 'set-home-color':
              res = await matchApi.setHomeColor(storage, data.matchId, data.jerseyColorHome);
              break;
            case 'set-opp-color':
              res = await matchApi.setOppColor(storage, data.matchId, data.jerseyColorOpp);
              break;
            case 'set-first-server':
              res = await matchApi.setFirstServer(storage, data.matchId, data.firstServer);
              break;
            case 'set-deleted':
              res = await matchApi.setDeleted(storage, data.matchId, data.deleted);
              break;
            case 'get':
              if (data.matchId) {
                res = await matchApi.getMatch(storage, data.matchId);
              } else {
                res = await matchApi.getMatches(storage);
              }
              break;
            case 'delete':
              res = await matchApi.deleteMatch(storage, data.id);
              break;
            default:
              throw new Error(`Unknown action for match: ${action}`);
          }
          break;

        case 'player':
          switch (action) {
            case 'create':
              const mockReq = {
                json: async () => data,
              } as Request;
              res = await playerApi.createPlayer(storage, mockReq);
              break;
            case 'set-lname':
              res = await playerApi.setPlayerLName(storage, data.playerId, data.lastName);
              break;
            case 'set-fname':
              res = await playerApi.setPlayerFName(storage, data.playerId, data.initial);
              break;
            case 'set-number':
              res = await playerApi.setPlayerNumber(storage, data.playerId, data.number);
              break;
            case 'get':
              if (data.id) {
                res = await playerApi.getPlayer(storage, data.id);
              } else {
                res = await playerApi.getPlayers(storage);
              }
              break;
            case 'delete':
              res = await playerApi.deletePlayer(storage, data.id);
              break;
            default:
              throw new Error(`Unknown action for player: ${action}`);
          }
          break;

        case 'set':
          switch (action) {
            case 'create':
              const mockReq = {
                json: async () => data,
              } as Request;
              res = await setApi.createSet(storage, mockReq);
              break;
            case 'set-home-score':
              res = await setApi.setHomeScore(storage, data.setId, data.homeScore);
              break;
            case 'set-opp-score':
              res = await setApi.setOppScore(storage, data.setId, data.oppScore);
              break;
            case 'set-home-timeout':
              res = await setApi.setHomeTimeout(storage, data.setId, data.timeoutNumber, data.value);
              break;
            case 'set-opp-timeout':
              res = await setApi.setOppTimeout(storage, data.setId, data.timeoutNumber, data.value);
              break;
            case 'set-is-final':
              res = await setApi.setIsFinal(storage, data.matchId, data.finalizedSets);
              break;
            case 'get':
              if (data.id) {
                res = await setApi.getSet(storage, data.id);
              } else {
                res = await setApi.getSets(storage, data.matchId);
              }
              break;
            case 'delete':
              res = await setApi.deleteSet(storage, data.id);
              break;
            default:
              throw new Error(`Unknown action for set: ${action}`);
          }
          break;

        default:
          throw new Error(`Unknown resource: ${resource}`);
      }

      // Prepare response to send over WS to sender
      let body: any;
      const contentType = res.headers.get('Content-Type');
      if (contentType?.includes('json')) {
        body = await res.json();
      } else {
        body = await res.text();
      }
      ws.send(JSON.stringify({
        resource,
        action,
        status: res.status,
        body,
      }));

      // If successful write action, broadcast update/delete to other clients
      if (res.status < 300 && action !== 'get') {
        const id = this.getIdFromData(resource, action, data, body);
        if (this.isDebug) console.log(`Write success (status ${res.status}). ID for broadcast: ${id}`);
        if (id || (resource === 'set' && action === 'set-is-final' && data.matchId)) {
          let broadcastMsg: string;

          if (action === 'delete') {
            broadcastMsg = JSON.stringify({ type: 'delete', resource, id });
          } else if (resource === 'set' && action === 'set-is-final') {
            // Special: Broadcast all sets for the match
            const setsRes = await setApi.getSets(storage, data.matchId);
            const setsData = await setsRes.json();
            broadcastMsg = JSON.stringify({ type: 'update', resource: 'sets', matchId: data.matchId, data: setsData });
          } else {
            // Standard: Broadcast updated entity
            const updated = await this.getUpdated(resource, id!);
            broadcastMsg = JSON.stringify({ type: 'update', resource, id, data: updated });
          }
          if (this.isDebug) console.log(`Broadcast message prepared: ${broadcastMsg.substring(0, 100)}...`);

          this.broadcast(broadcastMsg, ws);  // Exclude sender
        } else if (this.isDebug) {
          console.log('No ID found - skipping broadcast');
        }
      } else if (this.isDebug) {
        console.log(`No broadcast: status=${res.status}, action=${action}`);
      }

    } catch (e) {
      ws.send(JSON.stringify({
        error: {
          message: (e as Error).message,
        }
      }));
      if (this.isDebug) console.error(e);
    }
  }

  // Clean up closed connections
  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
    if (this.isDebug) console.log(`WS closed: ${code} - ${reason}. Total attached now: ${this.state.webSockets?.length ?? 0}`);
  }

  // Handle errors (optional, but cleans up)
  async webSocketError(ws: WebSocket, error: any) {
    if (this.isDebug) console.error(`WS error: ${error}. Total attached now: ${this.state.webSockets?.length ?? 0}`);
  }

  // Helper: Extract ID from data or body
  private getIdFromData(resource: string, action: string, data: any, body: any): number | undefined {
    if (action === 'create' && body.id) {
      return body.id;
    }
    switch (resource) {
      case 'match':
        return data.matchId || data.id;
      case 'player':
        return data.playerId || data.id;
      case 'set':
        return data.setId || data.id;
      default:
        return undefined;
    }
  }

  // Helper: Fetch updated entity (atomic read after write)
  private async getUpdated(resource: string, id: number): Promise<any> {
    const storage = this.state.storage;
    switch (resource) {
      case 'match':
        const matchRes = await matchApi.getMatch(storage, id);
        return await matchRes.json();
      case 'player':
        const playerRes = await playerApi.getPlayer(storage, id);
        return await playerRes.json();
      case 'set':
        const setRes = await setApi.getSet(storage, id);
        return await setRes.json();
      default:
        throw new Error(`No getUpdated for resource: ${resource}`);
    }
  }

  // Helper: Broadcast to all attached WS except exclude (e.g., sender)
  private broadcast(message: string, exclude?: WebSocket) {
    let sentCount = 0;
    for (const conn of this.state.webSockets || []) {
      if (conn !== exclude) {
        conn.send(message);
        sentCount++;
      }
    }
    if (this.isDebug) console.log(`Broadcasted to ${sentCount} clients (total attached: ${this.state.webSockets?.length ?? 0})`);
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

    /* 4. Handle WebSocket upgrades for /ws */
    if (path.startsWith("/ws")) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected Upgrade: websocket", { status: 426 });
      }

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

      const doBindingName = findDurableObjectBinding(env);
      if (!doBindingName) {
        return new Response("Durable Object binding not found", { status: 500 });
      }

      const doId = (env as any)[doBindingName].idFromName("global");
      const doStub = (env as any)[doBindingName].get(doId);

      doStub.acceptWebSocket(server);

      return new Response(null, { status: 101, webSocket: client });
    }

    /* 5. Route /api/* to the Durable Object */
    if (path.startsWith("/api/")) {
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

    /* 6. Fallback for unhandled paths */
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