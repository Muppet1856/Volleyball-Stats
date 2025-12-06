// src/index.ts
import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import {
  generateRegistrationOptions,
  generateAuthenticationOptions,
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server'
import { initMatchTable, initPlayerTable, initSetTable } from "./utils/init";
import { jsonResponse, errorResponse } from "./utils/responses";

import * as matchApi from "./api/match";
import * as playerApi from "./api/player";
import * as setApi from "./api/set";

import auth from './api/auth';
import orgs from './api/orgs';
import teams from './api/teams';
import { AUTH_COOKIE_NAME, authMiddleware, extractTokenFromRequest } from './api/helpers';

import jwt from '@tsndr/cloudflare-worker-jwt';

export interface Env {
  ASSETS: any;
  DB: D1Database;
  Match_DO: DurableObjectNamespace;
  RESEND_API_KEY: string;
  APP_URL: string;
  debug?: string;
  HOME_TEAM?: string;
  JWT_SECRET: string;
}

async function getUserWithRoles(db: D1Database, userId: string) {
  const user = await db.prepare('SELECT id, email, name, verified FROM users WHERE id = ?').bind(userId).first();
  if (!user) return null;
  const { results: roles } = await db.prepare('SELECT role, org_id, team_id FROM user_roles WHERE user_id = ?').bind(userId).all();
  return { ...user, roles };
}

const BROADCAST_EVENT_TIMESTAMP_ACTIONS: Record<string, ReadonlySet<string>> = {
  set: new Set(['set-home-score', 'set-opp-score', 'set-home-timeout', 'set-opp-timeout']),
};

const PROTECTED_PREFIXES = ['/main', '/scorekeeper', '/follower'];
type AuthedUser = Awaited<ReturnType<typeof getUserWithRoles>>;

function pathRequiresAuth(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function redirectToLogin(c: any) {
  const url = new URL(c.req.url);
  const target = `${url.pathname}${url.search}`;
  const redirect = encodeURIComponent(target || '/');
  const location = new URL(`/?redirect=${redirect}`, url.origin).toString();
  return c.redirect(location, 302);
}

function buildLoginRedirectResponse(request: Request) {
  const url = new URL(request.url);
  const target = `${url.pathname}${url.search}`;
  const redirect = encodeURIComponent(target || '/');
  const location = new URL(`/?redirect=${redirect}`, url.origin).toString();
  return Response.redirect(location, 302);
}

async function getAuthorizedUser(request: Request, env: Env): Promise<AuthedUser | null> {
  const token = extractTokenFromRequest(request, AUTH_COOKIE_NAME);
  if (!token) return null;

  try {
    if (!await jwt.verify(token, env.JWT_SECRET)) {
      return null;
    }
    const payload = jwt.decode(token).payload as { id?: string };
    if (!payload?.id) {
      return null;
    }
    const user = await getUserWithRoles(env.DB, payload.id);
    return user ?? null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------
   Durable Object - holds the SQLite DB
   ------------------------------------------------- */
export class MatchState {
  state: DurableObjectState;
  env: Env;
  isDebug: boolean;
  // Track WebSocket clients that explicitly subscribe to match IDs.
  // Missing or empty subscription set means the client receives all broadcasts.
  private matchSubscriptions: Map<string, Set<number>> = new Map();

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.isDebug = env.debug === "true";

    // Init all tables the first time the DO is created
    const sql = this.state.storage.sql;
    initMatchTable(sql);
    initPlayerTable(sql);
    initSetTable(sql);

    this.restoreSubscriptionsFromAttachments();
  }

  async fetch(request: Request): Promise<Response> {
    const storage = this.state.storage;
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle WebSocket upgrades for /ws inside the DO
    if (path.startsWith("/ws")) {
      // Authentication logic
      const user = await getAuthorizedUser(request, this.env);
      if (!user) {
        return new Response('Unauthorized', { status: 401 });
      }
      // Proceed with WebSocket upgrade
      const upgradeHeader = request.headers.get("Upgrade");
      if (upgradeHeader !== "websocket") {
        return new Response("Expected Upgrade: websocket", { status: 426 });
      }

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

      // Generate unique client ID
      const clientId = Math.random().toString(36).slice(2);

      // Accept the WebSocket with clientId as tag
      this.state.acceptWebSocket(server, [clientId]);

      // Persist base attachment so subscriptions survive hibernation
      this.matchSubscriptions.set(clientId, new Set());
      this.persistSubscriptionAttachment(server, clientId, new Set());

      // Send debug message if enabled (no initial data dump)
      if (this.isDebug) {
        const sql = this.state.storage.sql;
        const cursor = sql.exec('SELECT COUNT(*) FROM matches');
        const count = cursor.next().value['COUNT(*)'];
        server.send(JSON.stringify({ debug: `${count} matches in DB` }));
        server.send(JSON.stringify({ debug: `New client connected: ${clientId}` }));
      }

      return new Response(null, { status: 101, webSocket: client });
    }

    return errorResponse("Method not allowed", 405);  // Updated with responses.ts
  }

  // Handle WebSocket messages (dispatched by runtime after acceptWebSocket)
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const clientId = this.getClientId(ws) ?? 'undefined';
    const storage = this.state.storage;
    try {
      // Handle potential ArrayBuffer (safe for text/binary; Miniflare might send text as buffer)
      let msgStr: string;
      if (message instanceof ArrayBuffer) {
        msgStr = new TextDecoder().decode(message);
      } else {
        msgStr = message;
      }
      const payload = JSON.parse(msgStr);
      const resource = Object.keys(payload)[0];
      if (!resource) throw new Error('Invalid payload: missing resource');

      const actionObj = payload[resource];
      const action = Object.keys(actionObj)[0];
      if (!action) throw new Error('Invalid payload: missing action');

      const data = actionObj[action] || {};

      let res: Response;
      let matchId: number | undefined;

      switch (resource) {
        case 'match':
          switch (action) {
            case 'subscribe': {
              const normalized = this.normalizeMatchId(data.matchId ?? data.id);
              if (!normalized) {
                throw new Error('Invalid matchId for subscribe');
              }
              this.addMatchSubscription(ws, normalized);
              res = jsonResponse({ matchId: normalized });
              matchId = normalized;
              break;
            }
            case 'unsubscribe': {
              const normalized = this.normalizeMatchId(data.matchId ?? data.id);
              if (normalized) {
                this.removeMatchSubscription(ws, normalized);
              } else {
                this.removeMatchSubscription(ws);
              }
              res = jsonResponse({ matchId: normalized ?? null });
              matchId = normalized ?? undefined;
              break;
            }
            case 'create':
              // Mock Request for create
              const mockReq = {
                json: async () => data,
              } as Request;
              res = await matchApi.createMatch(storage, mockReq);
              matchId = (await res.clone().json()).id;
              break;
            case 'set-location':
              res = await matchApi.setLocation(storage, data.matchId, data.location);
              matchId = data.matchId;
              break;
            case 'set-date-time':
              res = await matchApi.setDateTime(storage, data.matchId, data.date);
              matchId = data.matchId;
              break;
            case 'set-opp-name':
              res = await matchApi.setOppName(storage, data.matchId, data.opponent);
              matchId = data.matchId;
              break;
            case 'set-type':
              res = await matchApi.setType(storage, data.matchId, data.types);
              matchId = data.matchId;
              break;
            case 'set-result':
              res = await matchApi.setResult(storage, data.matchId, data.resultHome, data.resultOpp);
              matchId = data.matchId;
              break;
            case 'set-players':
              res = await matchApi.setPlayers(storage, data.matchId, data.players);
              matchId = data.matchId;
              break;
            case 'add-player':
              res = await matchApi.addPlayer(storage, data.matchId, data.player);
              matchId = data.matchId;
              break;
            case 'remove-player':
              res = await matchApi.removePlayer(storage, data.matchId, data.player);
              matchId = data.matchId;
              break;
            case 'update-player':
              res = await matchApi.updatePlayer(storage, data.matchId, data.player);
              matchId = data.matchId;
              break;
            case 'add-temp-number':
              res = await matchApi.addTempNumber(storage, data.matchId, data.tempNumber ?? data.temp_number ?? data.temp);
              matchId = data.matchId;
              break;
            case 'update-temp-number':
              res = await matchApi.updateTempNumber(storage, data.matchId, data.tempNumber ?? data.temp_number ?? data.temp);
              matchId = data.matchId;
              break;
            case 'remove-temp-number':
              res = await matchApi.removeTempNumber(storage, data.matchId, data.tempNumber ?? data.temp_number ?? data.temp);
              matchId = data.matchId;
              break;
            case 'set-home-color':
              res = await matchApi.setHomeColor(storage, data.matchId, data.jerseyColorHome);
              matchId = data.matchId;
              break;
            case 'set-opp-color':
              res = await matchApi.setOppColor(storage, data.matchId, data.jerseyColorOpp);
              matchId = data.matchId;
              break;
            case 'set-first-server':
              res = await matchApi.setFirstServer(storage, data.matchId, data.firstServer);
              matchId = data.matchId;
              break;
            case 'set-deleted':
              res = await matchApi.setDeleted(storage, data.matchId, data.deleted);
              matchId = data.matchId;
              break;
            case 'get':
              if (data.matchId) {
                res = await matchApi.getMatch(storage, data.matchId);
                matchId = data.matchId;
              } else {
                res = await matchApi.getMatches(storage);
              }
              break;
            case 'delete':
              res = await matchApi.deleteMatch(storage, data.id);
              matchId = data.id;
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
              const normalizedSetData = {
                ...data,
                match_id: data.match_id ?? data.matchId,
                set_number: data.set_number ?? data.setNumber,
                home_score: data.home_score ?? data.homeScore,
                opp_score: data.opp_score ?? data.oppScore,
                home_timeout_1: data.home_timeout_1 ?? data.homeTimeout1 ?? data.homeTimeout_1,
                home_timeout_2: data.home_timeout_2 ?? data.homeTimeout2 ?? data.homeTimeout_2,
                opp_timeout_1: data.opp_timeout_1 ?? data.oppTimeout1 ?? data.oppTimeout_1,
                opp_timeout_2: data.opp_timeout_2 ?? data.oppTimeout2 ?? data.oppTimeout_2,
                timeout_started_at: data.timeout_started_at ?? data.timeoutStartedAt ?? null,
              };
              const mockReq = {
                json: async () => normalizedSetData,
              } as Request;
              res = await setApi.createSet(storage, mockReq);
              matchId = normalizedSetData.match_id; // Assume provided; fallback if needed
              break;
            case 'set-home-score':
              res = await setApi.setHomeScore(storage, data.setId, data.homeScore);
              matchId = data.matchId;
              break;
            case 'set-opp-score':
              res = await setApi.setOppScore(storage, data.setId, data.oppScore);
              matchId = data.matchId;
              break;
            case 'set-home-timeout': {
              const timeoutStartedAt = this.normalizeTimeoutTimestamp(data.value, data);
              res = await setApi.setHomeTimeout(storage, data.setId, data.timeoutNumber, data.value, timeoutStartedAt);
              data.timeoutStartedAt = timeoutStartedAt;
              matchId = data.matchId;
              break;
            }
            case 'set-opp-timeout': {
              const timeoutStartedAt = this.normalizeTimeoutTimestamp(data.value, data);
              res = await setApi.setOppTimeout(storage, data.setId, data.timeoutNumber, data.value, timeoutStartedAt);
              data.timeoutStartedAt = timeoutStartedAt;
              matchId = data.matchId;
              break;
            }
            case 'set-is-final':
              res = await setApi.setIsFinal(storage, data.matchId, data.finalizedSets);
              matchId = data.matchId;
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
              matchId = data.matchId;
              break;
            default:
              throw new Error(`Unknown action for set: ${action}`);
          }
          if (!matchId && data.setId) {
            // Fallback fetch if not provided
            const setRes = await setApi.getSet(storage, data.setId);
            const setData = await setRes.json();
            matchId = setData.match_id;
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
      const responseMsg = JSON.stringify({
        resource,
        action,
        status: res.status,
        body,
      });
      ws.send(responseMsg);

      // If successful write action, broadcast update/delete to other clients
      if (res.status < 300 && action !== 'get') {
        const id = this.getIdFromData(resource, action, data, body);

        const broadcastMsg = await this.prepareBroadcastMessage({
          resource,
          action,
          id,
          matchId,
          data,
        });

        if (broadcastMsg) {
          this.broadcast(broadcastMsg, ws);  // Exclude sender
        }
      }

    } catch (e) {
      ws.send(JSON.stringify({
        error: {
          message: (e as Error).message,
        }
      }));
    }
  }

  // Clean up closed connections
  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
    const clientId = this.getClientId(ws);
    if (clientId) {
      this.matchSubscriptions.delete(clientId);
    }
    const label = clientId ?? 'undefined';
  }

  // Handle errors (optional, but cleans up)
  async webSocketError(ws: WebSocket, error: any) {
    const tags = this.state.getTags(ws);
    const clientId = tags.length > 0 ? tags[0] : 'undefined';
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

  // Build a minimal broadcast payload for the given action
  private async prepareBroadcastMessage(params: { resource: string; action: string; id?: number; matchId?: number; data: any; }): Promise<string | undefined> {
    const { resource, action, id, matchId, data } = params;

    if (action === 'delete') {
      if (id === undefined) return undefined;
      const payload: any = { type: 'delete', resource, id };
      if (matchId !== undefined) payload.matchId = matchId;
      return JSON.stringify(payload);
    }

    if (resource === 'set' && action === 'set-is-final' && matchId) {
      // Special: Broadcast all sets for the match
      const setsRes = await setApi.getSets(this.state.storage, matchId);
      const setsData = await setsRes.json();
      return JSON.stringify({ type: 'update', resource: 'sets', action, matchId, data: setsData });
    }

    if (action === 'create') {
      if (id === undefined) return undefined;
      // Creation still sends the full record to allow clients to render new items
      const created = await this.getUpdated(resource, id);
      const payload: any = { type: 'update', resource, action, id, data: created };
      if (matchId !== undefined) payload.matchId = matchId;
      this.maybeStampBroadcast(payload, resource, action);
      return JSON.stringify(payload);
    }

    if (id === undefined) return undefined;

    const changes = await this.getChanges(resource, action, id, data, matchId);
    if (!changes) return undefined;

    const prunedChanges = Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined));
    if (Object.keys(prunedChanges).length === 0) return undefined;

    const payload: any = { type: 'update', resource, action, id, changes: prunedChanges };
    if (matchId !== undefined) payload.matchId = matchId;
    this.maybeStampBroadcast(payload, resource, action);
    return JSON.stringify(payload);
  }

  private async getChanges(resource: string, action: string, id: number, data: any, matchId?: number): Promise<Record<string, any> | null> {
    switch (resource) {
      case 'match':
        return this.getMatchChanges(action, id, data);
      case 'player':
        return this.getPlayerChanges(action, id, data);
      case 'set':
        return this.getSetChanges(action, id, data, matchId);
      default:
        return null;
    }
  }

  private async getMatchChanges(action: string, matchId: number, data: any): Promise<Record<string, any> | null> {
    switch (action) {
      case 'set-location':
        return { location: data.location ?? null };
      case 'set-date-time':
        return { date: data.date ?? null };
      case 'set-opp-name':
        return { opponent: data.opponent ?? null };
      case 'set-type':
        return { types: this.coerceJsonString(data.types, {}) };
      case 'set-result':
        return {
          result_home: this.normalizeScore(data.resultHome),
          result_opp: this.normalizeScore(data.resultOpp),
        };
      case 'set-players':
        return {
          players: this.coerceJsonString(data.players, []),
          temp_numbers: await this.getMatchColumn(matchId, 'temp_numbers'),
        };
      case 'add-player':
      case 'update-player': {
        const playerDelta = this.normalizePlayerDelta(data.player);
        const tempDelta = this.normalizeTempDelta(data.player);
        if (!playerDelta && !tempDelta) return null;
        return {
          player_delta: playerDelta,
          temp_number_delta: tempDelta ?? undefined,
        };
      }
      case 'remove-player': {
        const playerDelta = this.normalizePlayerRemoval(data.player);
        if (!playerDelta) return null;
        return {
          player_delta: playerDelta,
          temp_number_delta: { player_id: playerDelta.player_id, deleted: true },
        };
      }
      case 'add-temp-number':
      case 'update-temp-number': {
        const tempDelta = this.normalizeTempDelta(data.tempNumber ?? data.temp_number ?? data.temp);
        if (!tempDelta) return null;
        return { temp_number_delta: tempDelta };
      }
      case 'remove-temp-number': {
        const tempDelta = this.normalizeTempRemoval(data.tempNumber ?? data.temp_number ?? data.temp);
        if (!tempDelta) return null;
        return { temp_number_delta: tempDelta };
      }
      case 'set-home-color':
        return { jersey_color_home: data.jerseyColorHome ?? null };
      case 'set-opp-color':
        return { jersey_color_opp: data.jerseyColorOpp ?? null };
      case 'set-first-server':
        return { first_server: data.firstServer ?? null };
      case 'set-deleted':
        return { deleted: this.normalizeDeletedFlag(data.deleted) };
      default:
        return null;
    }
  }

  private getPlayerChanges(action: string, _playerId: number, data: any): Record<string, any> | null {
    switch (action) {
      case 'set-lname':
        return { last_name: data.lastName ?? null };
      case 'set-fname':
        return { initial: data.initial ?? null };
      case 'set-number':
        return { number: data.number ?? null };
      default:
        return null;
    }
  }

  private getSetChanges(action: string, _setId: number, data: any, matchId?: number): Record<string, any> | null {
    switch (action) {
      case 'set-home-score':
        return { home_score: this.normalizeScore(data.homeScore) };
      case 'set-opp-score':
        return { opp_score: this.normalizeScore(data.oppScore) };
      case 'set-home-timeout': {
        const field = data.timeoutNumber === 2 || data.timeoutNumber === '2' ? 'home_timeout_2' : 'home_timeout_1';
        return {
          [field]: this.normalizeTimeoutFlag(data.value),
          timeout_started_at: this.normalizeTimeoutTimestamp(data.value, data),
        };
      }
      case 'set-opp-timeout': {
        const field = data.timeoutNumber === 2 || data.timeoutNumber === '2' ? 'opp_timeout_2' : 'opp_timeout_1';
        return {
          [field]: this.normalizeTimeoutFlag(data.value),
          timeout_started_at: this.normalizeTimeoutTimestamp(data.value, data),
        };
      }
      case 'set-is-final':
        return matchId ? { finalized_sets: data.finalizedSets } : null;
      default:
        return null;
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

  private async getMatchColumn(matchId: number, column: string): Promise<any> {
    const sql = this.state.storage.sql;
    const cursor = sql.exec(`SELECT ${column} FROM matches WHERE id = ?`, matchId);
    const row = cursor.toArray()[0];
    return row ? row[column] : undefined;
  }

  private normalizeScore(value: any): number | null {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    return parsed;
  }

  private normalizeDeletedFlag(value: any): number {
    if (typeof value === "string") {
      const lower = value.trim().toLowerCase();
      if (lower === "true" || lower === "1") {
        return 1;
      }
      return 0;
    }
    if (typeof value === "number") {
      return value !== 0 ? 1 : 0;
    }
    return value ? 1 : 0;
  }

  private coerceJsonString(value: any, fallback: any = {}): string {
    if (typeof value === "string") {
      return value;
    }
    try {
      return JSON.stringify(value ?? fallback);
    } catch (error) {
      return JSON.stringify(fallback);
    }
  }

  private normalizeTimeoutFlag(value: any): number {
    if (value === null || value === undefined) {
      return 0;
    }
    if (typeof value === "boolean") {
      return value ? 1 : 0;
    }
    if (typeof value === "string") {
      if (value.trim() === "") return 0;
      const parsed = Number(value);
      if (Number.isNaN(parsed)) {
        return value ? 1 : 0;
      }
      return parsed ? 1 : 0;
    }
    if (typeof value === "number") {
      return value ? 1 : 0;
    }
    return 0;
  }

  private normalizeTimeoutTimestamp(value: any, data?: any): string | null {
    const normalizedValue = this.normalizeTimeoutFlag(value);
    if (!normalizedValue) {
      return null;
    }

    const hasProvidedTimestamp = data && ("timeoutStartedAt" in data || "timeout_started_at" in data);
    if (hasProvidedTimestamp) {
      const rawTimestamp = data.timeoutStartedAt ?? data.timeout_started_at;
      if (rawTimestamp === null || rawTimestamp === undefined) {
        return null;
      }
      const parsed = new Date(rawTimestamp);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    }

    return new Date().toISOString();
  }

  private maybeStampBroadcast(payload: any, resource: string, action: string): void {
    const actions = BROADCAST_EVENT_TIMESTAMP_ACTIONS[resource];
    if (actions?.has(action)) {
      payload.eventTimestamp = new Date().toISOString();
    }
  }

  private parseJsonMaybe(raw: any): any {
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    }
    return raw;
  }

  private normalizePlayerDelta(raw: any): { player_id: number; appeared?: boolean; temp_number?: number | null } | null {
    const parsed = this.parseJsonMaybe(raw);
    const playerId = parsed?.player_id ?? parsed?.playerId ?? parsed?.id;
    if (typeof playerId !== "number") return null;

    const appearedRaw = parsed?.appeared ?? parsed?.active ?? parsed?.selected;
    const appeared = appearedRaw === undefined ? undefined : !!appearedRaw;

    const tempRaw = parsed?.temp_number ?? parsed?.tempNumber;
    const tempParsed = tempRaw === undefined || tempRaw === null || tempRaw === "" ? null : Number(tempRaw);
    const hasTemp = tempRaw !== undefined;

    const payload: any = { player_id: playerId };
    if (appeared !== undefined) payload.appeared = appeared;
    if (hasTemp && !Number.isNaN(tempParsed)) {
      payload.temp_number = tempParsed;
    }
    return payload;
  }

  private normalizePlayerRemoval(raw: any): { player_id: number; deleted: true } | null {
    const parsed = this.parseJsonMaybe(raw);
    const playerId = parsed?.player_id ?? parsed?.playerId ?? parsed?.id;
    if (typeof playerId !== "number") return null;
    return { player_id: playerId, deleted: true };
  }

  private normalizeTempDelta(raw: any): { player_id: number; temp_number: number | null } | null {
    const parsed = this.parseJsonMaybe(raw);
    const playerId = parsed?.player_id ?? parsed?.playerId ?? parsed?.id;
    const tempRaw = parsed?.temp_number ?? parsed?.tempNumber;
    if (typeof playerId !== "number" || tempRaw === undefined) return null;
    const tempParsed = tempRaw === null || tempRaw === "" ? null : Number(tempRaw);
    if (tempParsed === null || Number.isFinite(tempParsed)) {
      return { player_id: playerId, temp_number: tempParsed };
    }
    return null;
  }

  private normalizeTempRemoval(raw: any): { player_id: number; deleted: true } | null {
    const parsed = this.parseJsonMaybe(raw);
    const playerId = parsed?.player_id ?? parsed?.playerId ?? parsed?.id;
    if (typeof playerId !== "number") return null;
    return { player_id: playerId, deleted: true };
  }

  private restoreSubscriptionsFromAttachments(): void {
    const sockets = this.state.getWebSockets ? this.state.getWebSockets() : [];
    for (const socket of sockets) {
      const clientId = this.getClientId(socket);
      if (!clientId) continue;
      const restored = this.extractMatchIdsFromAttachment(socket);
      if (restored) {
        this.matchSubscriptions.set(clientId, restored);
      }
    }
  }

  private safeDeserializeAttachment(ws: WebSocket): any | null {
    const socketAny = ws as any;
    if (!socketAny || typeof socketAny.deserializeAttachment !== "function") {
      return null;
    }
    try {
      return socketAny.deserializeAttachment();
    } catch (error) {
      if (this.isDebug) {
        console.error("Failed to deserialize WebSocket attachment", error);
      }
      return null;
    }
  }

  private extractMatchIdsFromAttachment(ws: WebSocket): Set<number> | undefined {
    const attachment = this.safeDeserializeAttachment(ws);
    if (!attachment || typeof attachment !== "object") {
      return undefined;
    }
    const rawIds = Array.isArray((attachment as any).matchIds)
      ? (attachment as any).matchIds
      : Array.isArray((attachment as any).match_ids)
        ? (attachment as any).match_ids
        : null;
    if (!rawIds) return undefined;
    const normalized: number[] = [];
    for (const raw of rawIds) {
      const id = this.normalizeMatchId(raw);
      if (id !== null) {
        normalized.push(id);
      }
    }
    if (normalized.length === 0) return undefined;
    // Enforce single-subscription rule: keep only the most recent entry.
    const last = normalized[normalized.length - 1];
    return new Set<number>([last]);
  }

  private persistSubscriptionAttachment(ws: WebSocket, clientId: string, matchIds: Set<number>): void {
    const socketAny = ws as any;
    if (!socketAny || typeof socketAny.serializeAttachment !== "function") {
      return;
    }
    try {
      socketAny.serializeAttachment({ clientId, matchIds: Array.from(matchIds) });
    } catch (error) {
      if (this.isDebug) {
        console.error("Failed to serialize WebSocket attachment", error);
      }
    }
  }

  private getSubscriptionsForSocket(ws: WebSocket): { clientId: string | null; subscriptions?: Set<number> } {
    const clientId = this.getClientId(ws);
    if (!clientId) {
      const restored = this.extractMatchIdsFromAttachment(ws);
      return { clientId: null, subscriptions: restored };
    }
    const cached = this.matchSubscriptions.get(clientId);
    if (cached) {
      return { clientId, subscriptions: cached };
    }
    const restored = this.extractMatchIdsFromAttachment(ws);
    if (restored) {
      this.matchSubscriptions.set(clientId, restored);
      return { clientId, subscriptions: restored };
    }
    return { clientId, subscriptions: undefined };
  }

  // Helper: Broadcast to all attached WS except exclude (e.g., sender)
  private broadcast(message: string, exclude?: WebSocket) {
    console.log('websocket broadcast =>', message);
    const targetMatchId = this.extractMatchIdForBroadcast(message);
    for (const conn of this.state.getWebSockets() || []) {
      if (conn === exclude) {
        continue;
      }
      if (!this.shouldDeliverBroadcast(conn, targetMatchId)) {
        continue;
      }
      conn.send(message);
    }
  }

  private addMatchSubscription(ws: WebSocket, matchId: number) {
    const { clientId } = this.getSubscriptionsForSocket(ws);
    if (!clientId) return;
    // Only one active subscription per client: replace any existing set.
    const next = new Set<number>([matchId]);
    this.matchSubscriptions.set(clientId, next);
    this.persistSubscriptionAttachment(ws, clientId, next);
  }

  private removeMatchSubscription(ws: WebSocket, matchId?: number) {
    const { clientId, subscriptions } = this.getSubscriptionsForSocket(ws);
    if (!clientId) return;
    if (matchId === undefined) {
      this.matchSubscriptions.delete(clientId);
      this.persistSubscriptionAttachment(ws, clientId, new Set());
      return;
    }
    if (!subscriptions) {
      this.persistSubscriptionAttachment(ws, clientId, new Set());
      return;
    }
    subscriptions.delete(matchId);
    if (subscriptions.size === 0) {
      this.matchSubscriptions.delete(clientId);
    } else {
      this.matchSubscriptions.set(clientId, subscriptions);
    }
    this.persistSubscriptionAttachment(ws, clientId, subscriptions);
  }

  private normalizeMatchId(raw: any): number | null {
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  private extractMatchIdForBroadcast(message: string): number | null {
    try {
      const parsed = JSON.parse(message);
      const rawMatchId = parsed?.matchId ?? parsed?.data?.matchId ?? parsed?.data?.match_id;
      const normalized = this.normalizeMatchId(rawMatchId);
      if (normalized !== null) return normalized;
      // Fallback: allow match create/delete messages that omit explicit matchId.
      if (parsed?.resource === 'match') {
        return this.normalizeMatchId(parsed?.id);
      }
      return null;
    } catch {
      return null;
    }
  }

  private shouldDeliverBroadcast(conn: WebSocket, targetMatchId: number | null): boolean {
    const { subscriptions } = this.getSubscriptionsForSocket(conn);
    // No subscriptions -> legacy behaviour: receive everything.
    if (!subscriptions || subscriptions.size === 0) return true;
    if (targetMatchId === null) return true;
    return subscriptions.has(targetMatchId);
  }

  private getClientId(ws: WebSocket): string | null {
    const tags = this.state.getTags(ws);
    const tagId = tags && tags.length > 0 && typeof tags[0] === "string" ? (tags[0] as string) : null;
    if (tagId) return tagId;
    const attachment = this.safeDeserializeAttachment(ws);
    const attachedId = attachment?.clientId ?? attachment?.client_id ?? attachment?.id;
    return typeof attachedId === "string" ? attachedId : null;
  }
}

const app = new Hono<{ Bindings: Env }>();

const api = new Hono<{ Bindings: Env }>();

// Apply auth middleware to protect everything (except login/verify) before mounting routers
api.use('*', authMiddleware);

// Require auth for UI pages that should not be publicly accessible
app.use('*', async (c, next) => {
  if (!pathRequiresAuth(c.req.path)) {
    return next();
  }

  const token = extractTokenFromRequest(c.req.raw, AUTH_COOKIE_NAME);
  if (!token) {
    return redirectToLogin(c);
  }

  try {
    if (!await jwt.verify(token, c.env.JWT_SECRET)) {
      throw new Error();
    }
    const payload = jwt.decode(token).payload as { id?: string };
    if (!payload?.id) {
      throw new Error();
    }
    const user = await getUserWithRoles(c.env.DB, payload.id);
    if (!user) {
      throw new Error();
    }
    c.set('user', user);
    return next();
  } catch {
    return redirectToLogin(c);
  }
});

// Explicit guards for protected static paths (defensive in case middleware is bypassed)
app.get('/main/*', async (c, next) => {
  const user = await getAuthorizedUser(c.req.raw, c.env);
  if (!user) return redirectToLogin(c);
  return next();
});
app.get('/scorekeeper/*', async (c, next) => {
  const user = await getAuthorizedUser(c.req.raw, c.env);
  if (!user) return redirectToLogin(c);
  return next();
});
app.get('/follower/*', async (c, next) => {
  const user = await getAuthorizedUser(c.req.raw, c.env);
  if (!user) return redirectToLogin(c);
  return next();
});

// Auth routes
api.route('/', auth);

// Mount other routers
api.route('/', orgs);
api.route('/', teams);

// Handle /api/config inside api router to apply auth
api.get('/config', (c) => {
  const homeTeam = c.env.HOME_TEAM || "Home Team";
  return c.json({ homeTeam });
});

// Mount API to app
app.route('/api', api);

// Silence Chrome DevTools probe
app.get('/.well-known/appspecific/com.chrome.devtools.json', (c) => c.json({}));

// Static assets fallback
app.get('*', async (c) => {
  try {
    const res = await c.env.ASSETS.fetch(c.req);
    return res;
  } catch {
    // Asset fetch errors bubble so Cloudflare still reports them
    return c.text('Internal Server Error', 500);
  }
});

/* -------------------------------------------------
   Top-level fetch – static files + DO routing
   ------------------------------------------------- */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (pathRequiresAuth(path)) {
      const user = await getAuthorizedUser(request, env);
      if (!user) {
        return buildLoginRedirectResponse(request);
      }
    }

    if (path.startsWith("/ws")) {
      try {
        const doId = env.Match_DO.idFromName("global");
        const doStub = env.Match_DO.get(doId);
        return await doStub.fetch(request);
      } catch (e) {
        return errorResponse(`DO fetch failed: ${(e as Error).message}`, 500);
      }
    }

    return app.fetch(request, env, ctx);
  },
};
