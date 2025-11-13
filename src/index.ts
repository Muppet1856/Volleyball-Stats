// src/index.ts
import { initMatchTable, initPlayerTable, initSetTable } from "./utils/init";
import { jsonResponse, errorResponse } from "./utils/responses";  // Add this import

import * as matchApi from "./api/match";
import * as playerApi from "./api/player";
import * as setApi from "./api/set";
import type { ScoreBroadcastUpdate, ScoreBroadcastCallback } from "./api/set";
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
  private socketsByMatch: Map<number, Set<WebSocket>>;
  private pingInterval: ReturnType<typeof setInterval> | null;
  private readonly scoreUpdateCallback: ScoreBroadcastCallback;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.isDebug = env.debug === "true";
    this.socketsByMatch = new Map();
    this.pingInterval = null;
    this.scoreUpdateCallback = (update: ScoreBroadcastUpdate) => this.broadcastScoreUpdate(update);

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

    /* ---------- /api/* routing ---------- */
    if (path.startsWith("/api/")) {
      if (path === "/api/live/score") {
        return this.handleLiveScore(request, url);
      }
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
            return setApi.createSet(storage, request, this.scoreUpdateCallback);
          } else if (request.method === "POST" && action === "set-home-score") {
            const body = await request.json();
            return setApi.setHomeScore(storage, body.setId, body.homeScore, this.scoreUpdateCallback);
          } else if (request.method === "POST" && action === "set-opp-score") {
            const body = await request.json();
            return setApi.setOppScore(storage, body.setId, body.oppScore, this.scoreUpdateCallback);
          } else if (request.method === "POST" && action === "set-home-timeout") {
            const body = await request.json();
            return setApi.setHomeTimeout(storage, body.setId, body.timeoutNumber, body.value, this.scoreUpdateCallback);
          } else if (request.method === "POST" && action === "set-opp-timeout") {
            const body = await request.json();
            return setApi.setOppTimeout(storage, body.setId, body.timeoutNumber, body.value, this.scoreUpdateCallback);
          } else if (request.method === "POST" && action === "set-is-final") {
            const body = await request.json();
            return setApi.setIsFinal(storage, body.matchId, body.finalizedSets, this.scoreUpdateCallback);
          } else if (request.method === "GET" && action === "get" && id) {
            return setApi.getSet(storage, id);
          } else if (request.method === "GET") {
            const matchIdQuery = url.searchParams.get("matchId");
            const parsedMatchId = matchIdQuery ? parseInt(matchIdQuery, 10) : undefined;
            const matchIdParam = Number.isNaN(parsedMatchId ?? NaN) ? undefined : parsedMatchId;
            return setApi.getSets(storage, matchIdParam);
          } else if (request.method === "DELETE" && action === "delete" && id) {
            return setApi.deleteSet(storage, id, this.scoreUpdateCallback);
          }
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

  private handleLiveScore(request: Request, url: URL): Response {
    if (request.method !== "GET") {
      return errorResponse("Method not allowed", 405);
    }

    const matchIdParam = url.searchParams.get("matchId");
    if (!matchIdParam) {
      return errorResponse("matchId is required", 400);
    }

    const matchId = Number(matchIdParam);
    if (!Number.isInteger(matchId) || matchId <= 0) {
      return errorResponse("Invalid matchId", 400);
    }

    const setNumberParam = url.searchParams.get("setNumber");
    let requestedSetNumber: number | null = null;
    if (setNumberParam !== null) {
      const parsedSetNumber = Number(setNumberParam);
      if (!Number.isInteger(parsedSetNumber) || parsedSetNumber <= 0) {
        return errorResponse("Invalid setNumber", 400);
      }
      requestedSetNumber = parsedSetNumber;
    }

    const sql = this.state.storage.sql;
    const matchRow = sql.exec(`SELECT id FROM matches WHERE id = ?`, matchId).toArray()[0];
    if (!matchRow) {
      return errorResponse("Match not found", 404);
    }

    if (requestedSetNumber !== null) {
      const setExists = sql.exec(`SELECT id FROM sets WHERE match_id = ? AND set_number = ?`, matchId, requestedSetNumber).toArray()[0];
      if (!setExists) {
        return errorResponse("Set not found", 404);
      }
    }

    let snapshot: ReturnType<MatchState["getScoreSnapshot"]>;
    try {
      snapshot = this.getScoreSnapshot(matchId, requestedSetNumber);
    } catch (error) {
      if (error instanceof Error && error.message === "MATCH_NOT_FOUND") {
        return errorResponse("Match not found", 404);
      }
      if (this.isDebug) {
        console.error("Failed to build score snapshot", error);
      }
      return errorResponse("Unable to fetch live score", 500);
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    server.accept();
    this.addSocket(matchId, server);

    try {
      this.sendJson(server, {
        type: "initial-state",
        matchId,
        setNumber: snapshot.setNumber,
        payload: snapshot.payload,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      if (this.isDebug) {
        console.error("Failed to send initial live score payload", error);
      }
      this.removeSocket(matchId, server);
      try {
        server.close(1011, "Initialization error");
      } catch (closeError) {
        if (this.isDebug) {
          console.error("Failed to close websocket after initialization error", closeError);
        }
      }
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  private addSocket(matchId: number, socket: WebSocket): void {
    const sockets = this.socketsByMatch.get(matchId) ?? new Set<WebSocket>();
    sockets.add(socket);
    this.socketsByMatch.set(matchId, sockets);

    socket.addEventListener("close", () => this.removeSocket(matchId, socket));
    socket.addEventListener("error", () => this.removeSocket(matchId, socket));
    socket.addEventListener("message", (event: MessageEvent<any>) => {
      if (typeof event.data === "string" && event.data.toLowerCase() === "ping") {
        try {
          this.sendJson(socket, { type: "pong", updatedAt: new Date().toISOString() });
        } catch (error) {
          if (this.isDebug) {
            console.error("Failed to respond to ping", error);
          }
        }
      }
    });

    this.ensurePingTimer();
  }

  private removeSocket(matchId: number, socket: WebSocket): void {
    const sockets = this.socketsByMatch.get(matchId);
    if (!sockets) {
      return;
    }
    sockets.delete(socket);
    if (sockets.size === 0) {
      this.socketsByMatch.delete(matchId);
    }
    this.clearPingTimerIfIdle();
  }

  private sendJson(socket: WebSocket, data: Record<string, unknown>): void {
    socket.send(JSON.stringify(data));
  }

  private broadcastScoreUpdate(update: ScoreBroadcastUpdate): void {
    const message = {
      ...update,
      updatedAt: new Date().toISOString(),
    };
    this.broadcastToMatch(update.matchId, message);
  }

  private broadcastToMatch(matchId: number, message: Record<string, unknown>): void {
    const sockets = this.socketsByMatch.get(matchId);
    if (!sockets || sockets.size === 0) {
      return;
    }

    const serialized = JSON.stringify(message);
    for (const socket of Array.from(sockets)) {
      try {
        socket.send(serialized);
      } catch (error) {
        if (this.isDebug) {
          console.error("Failed to broadcast to websocket", error);
        }
        this.removeSocket(matchId, socket);
      }
    }
  }

  private ensurePingTimer(): void {
    if (this.pingInterval !== null) {
      return;
    }
    this.pingInterval = setInterval(() => {
      const message = JSON.stringify({ type: "ping", updatedAt: new Date().toISOString() });
      for (const [matchId, sockets] of this.socketsByMatch.entries()) {
        for (const socket of Array.from(sockets)) {
          try {
            socket.send(message);
          } catch (error) {
            if (this.isDebug) {
              console.error("Failed to send ping", error);
            }
            this.removeSocket(matchId, socket);
          }
        }
      }
      if (this.socketsByMatch.size === 0) {
        this.clearPingTimerIfIdle();
      }
    }, 30_000);
  }

  private clearPingTimerIfIdle(): void {
    if (this.socketsByMatch.size === 0 && this.pingInterval !== null) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private getScoreSnapshot(matchId: number, requestedSetNumber: number | null): {
    setNumber: number | null;
    payload: {
      set: {
        id: number;
        homeScore: number | null;
        oppScore: number | null;
        homeTimeouts: { 1: number; 2: number };
        oppTimeouts: { 1: number; 2: number };
      } | null;
      finalizedSets: Record<number, boolean>;
    };
  } {
    const sql = this.state.storage.sql;
    const matchRow = sql.exec(`SELECT finalized_sets FROM matches WHERE id = ?`, matchId).toArray()[0];
    if (!matchRow) {
      throw new Error("MATCH_NOT_FOUND");
    }

    let setRow: any = null;
    if (requestedSetNumber !== null) {
      setRow = sql.exec(`SELECT * FROM sets WHERE match_id = ? AND set_number = ?`, matchId, requestedSetNumber).toArray()[0] ?? null;
    } else {
      setRow = sql.exec(`SELECT * FROM sets WHERE match_id = ? ORDER BY set_number DESC LIMIT 1`, matchId).toArray()[0] ?? null;
    }

    const setNumber = setRow ? Number(setRow.set_number) : requestedSetNumber;

    const setPayload = setRow
      ? {
          id: Number(setRow.id),
          homeScore: setRow.home_score !== null && setRow.home_score !== undefined ? Number(setRow.home_score) : null,
          oppScore: setRow.opp_score !== null && setRow.opp_score !== undefined ? Number(setRow.opp_score) : null,
          homeTimeouts: {
            1: Number(setRow.home_timeout_1 ?? 0),
            2: Number(setRow.home_timeout_2 ?? 0),
          },
          oppTimeouts: {
            1: Number(setRow.opp_timeout_1 ?? 0),
            2: Number(setRow.opp_timeout_2 ?? 0),
          },
        }
      : null;

    return {
      setNumber: setNumber ?? null,
      payload: {
        set: setPayload,
        finalizedSets: setApi.parseFinalizedSetsColumn(matchRow.finalized_sets),
      },
    };
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

    if (request.method === "GET" && (path === "/scorekeeper" || path === "/scorekeeper/")) {
      const scorekeeperUrl = new URL(request.url);
      scorekeeperUrl.pathname = "/scorekeeper.html";
      try {
        const scorekeeperAsset = await env.ASSETS.fetch(new Request(scorekeeperUrl.toString(), request));
        if (scorekeeperAsset && scorekeeperAsset.status < 400) {
          return scorekeeperAsset;
        }
      } catch (error) {
        if (env.debug === "true") console.log("Failed to serve scorekeeper asset:", (error as Error).message);
      }
    }

    /* 3. Handle /api/config directly (no DB needed) */
    if (path === "/api/config") {
      if (request.method !== "GET") {
        return errorResponse("Method not allowed", 405);
      }
      const homeTeam = env.HOME_TEAM || "Home Team";
      return jsonResponse({ homeTeam });
    }

    /* 4. Route other API requests to the Durable Object (singleton instance) */
    if (path.startsWith("/api/")) {
      const doBindingName = findDurableObjectBinding(env);
      if (!doBindingName) {
        return errorResponse("Durable Object binding not found in env", 500);
      }

      const doId = (env as any)[doBindingName].idFromName("global");
      const doStub = (env as any)[doBindingName].get(doId);
      return doStub.fetch(request);
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