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

export interface Env {
  ASSETS: any;
  DB: D1Database;
  MATCH_DO: DurableObjectNamespace;
  RESEND_API_KEY: string;
  APP_URL: string;
  debug?: string;
  HOME_TEAM?: string;
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
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle WebSocket upgrades for /ws inside the DO
    if (path.startsWith("/ws")) {
      const upgradeHeader = request.headers.get("Upgrade");
      if (upgradeHeader !== "websocket") {
        return new Response("Expected Upgrade: websocket", { status: 426 });
      }

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

      // Generate unique client ID
      const clientId = Math.random().toString(36).slice(2);
      if (this.isDebug) console.log(`New client connected: ${clientId}`);

      // Accept the WebSocket with clientId as tag
      this.state.acceptWebSocket(server, [clientId]);

      // Send debug message if enabled (no initial data dump)
      if (this.isDebug) {
        const sql = this.state.storage.sql;
        const cursor = sql.exec('SELECT COUNT(*) FROM matches');
        const count = cursor.next().value['COUNT(*)'];
        if (this.isDebug) console.log(`Sending debug count to client ${clientId}: ${count} matches`);
        server.send(`Debug: ${count} matches in DB`);
        server.send(`Debug: New client connected: ${clientId}`);
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
          } else if (request.method === "POST" && action === "add-player") {
            const body = await request.json();
            return matchApi.addPlayer(storage, body.matchId, body.player);
          } else if (request.method === "POST" && action === "remove-player") {
            const body = await request.json();
            return matchApi.removePlayer(storage, body.matchId, body.player);
          } else if (request.method === "POST" && action === "update-player") {
            const body = await request.json();
            return matchApi.updatePlayer(storage, body.matchId, body.player);
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

      return errorResponse("API endpoint not found", 404);
    }

    return errorResponse("Method not allowed", 405);
  }

  // Your webSocketMessage, webSocketClose, webSocketError, getIdFromData, getUpdated, broadcast functions (unchanged from your document)

}

/* -------------------------------------------------
   Top-level fetch – static files + DO routing with Hono
   ------------------------------------------------- */
const app = new Hono<{ Bindings: Env }>()

app.use('*', async (c, next) => {
  try {
    const resp = await c.env.ASSETS.fetch(c.req.raw)
    if (resp.status < 400) return resp
  } catch {}
  await next()
})

app.get('/.well-known/appspecific/com.chrome.devtools.json', () => new Response("{}", { headers: { "Content-Type": "application/json" } }))

app.get('/api/config', (c) => {
  return jsonResponse({ homeTeam: c.env.HOME_TEAM || "Stoney Creek" })
})

// Auth helpers
const getUserByEmail = async (db: D1Database, email: string) =>
  await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first()

const createSession = async (db: D1Database, userId: number) => {
  const token = crypto.randomUUID()
  const expires = Date.now() + 30 * 24 * 60 * 60 * 1000
  await db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(token, userId, expires).run()
  return token
}

const auth = async (c: any, next: any) => {
  const token = c.req.header('Authorization')?.split('Bearer ')[1] ||
                c.req.header('Cookie')?.match(/session=([^;]+)/)?.[1]
  if (!token) return c.json({ error: 'Unauthorized' }, 401)

  const session = await c.env.DB.prepare(
    'SELECT user_id FROM sessions WHERE token = ? AND expires_at > ?'
  ).bind(token, Date.now()).first()

  if (!session) return c.json({ error: 'Invalid session' }, 401)
  c.set('userId', session.user_id)
  await next()
}

const requireOrg = async (c: any, next: any) => {
  await auth(c, async () => {
    const orgId = c.req.param('orgId')
    if (!orgId) return c.json({ error: 'orgId required' }, 400)

    const membership = await c.env.DB.prepare(
      'SELECT role FROM user_organizations WHERE user_id = ? AND organization_id = ?'
    ).bind(c.get('userId'), orgId).first()

    if (!membership) return c.json({ error: 'Access denied to org' }, 403)
    c.set('orgId', orgId)
    c.set('orgRole', membership.role)
    await next()
  })
}

const requireTeam = async (c: any, next: any) => {
  await auth(c, async () => {
    const teamId = c.req.param('teamId')
    if (!teamId) return c.json({ error: 'teamId required' }, 400)

    const membership = await c.env.DB.prepare(
      'SELECT role FROM user_teams WHERE user_id = ? AND team_id = ?'
    ).bind(c.get('userId'), teamId).first()

    if (!membership) return c.json({ error: 'Access denied to team' }, 403)
    c.set('teamId', teamId)
    c.set('teamRole', membership.role)
    await next()
  })
}

// Magic links, passkeys, /me, /orgs, /my-orgs, /org/:orgId/teams, /my-teams endpoints as in previous messages...

// Sharded DO forwarding
app.all('/team/:teamId/api/*', requireTeam, async (c) => {
  const teamId = c.get('teamId')
  const id = c.env.MATCH_DO.idFromName(teamId.toString())
  const stub = c.env.MATCH_DO.get(id)
  const newUrl = new URL(c.req.url)
  newUrl.pathname = newUrl.pathname.replace(`/team/${teamId}`, '')
  const newReq = new Request(newUrl, c.req)
  return stub.fetch(newReq)
})

app.get('/team/:teamId/ws', requireTeam, async (c) => {
  if (c.req.headers.get('upgrade') !== 'websocket') return new Response('Expected websocket', { status: 426 })
  const teamId = c.get('teamId')
  const id = c.env.MATCH_DO.idFromName(teamId.toString())
  const stub = c.env.MATCH_DO.get(id)
  const newUrl = new URL(c.req.url)
  newUrl.pathname = '/ws'
  const newReq = new Request(newUrl, c.req)
  return stub.fetch(newReq)
})

app.notFound(() => new Response("Not Found", { status: 404 }))

export default app