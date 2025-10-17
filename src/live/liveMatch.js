import { deserializeMatchRow } from '../api/matches/utils.js';
import { getDatabase } from '../api/database.js';

const LAST_BROADCAST_KEY = 'lastBroadcast';

export class LiveMatchDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.connections = new Map();
    this.ready = this.state.storage
      .get(LAST_BROADCAST_KEY)
      .then((payload) => {
        this.lastBroadcast = payload ?? null;
      })
      .catch((error) => {
        console.error('Failed to restore live match state', error);
        this.lastBroadcast = null;
      });
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(request);
    }

    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/broadcast') {
      return this.handleBroadcast(request);
    }

    if (request.method === 'GET' && url.pathname === '/state') {
      await this.ready;
      return Response.json({
        connectionCount: this.connections.size,
        lastBroadcast: this.lastBroadcast
      });
    }

    return new Response('Not found', { status: 404 });
  }

  async handleWebSocket(request) {
    const webSocket = request.webSocket;
    if (!webSocket) {
      return new Response('Expected WebSocket', { status: 426 });
    }

    await this.ready;
    webSocket.accept();

    const connectionId = crypto.randomUUID();
    this.connections.set(connectionId, webSocket);

    const cleanup = () => {
      const socket = this.connections.get(connectionId);
      if (socket) {
        try {
          socket.close(1000, 'Closing connection');
        } catch (error) {
          // Ignore errors while closing sockets during cleanup
        }
      }
      this.connections.delete(connectionId);
    };

    webSocket.addEventListener('close', () => cleanup());
    webSocket.addEventListener('error', () => cleanup());

    try {
      const payload = await this.ensureInitialPayload();
      if (payload) {
        webSocket.send(JSON.stringify(payload));
      }
    } catch (error) {
      console.error('Failed to send initial live match payload', error);
    }

    return new Response(null, { status: 101, webSocket });
  }

  async handleBroadcast(request) {
    let payload;
    try {
      payload = await request.json();
    } catch (error) {
      return Response.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    if (!payload || payload.type !== 'broadcastScore' || !payload.match) {
      return Response.json({ error: 'Invalid broadcast payload' }, { status: 400 });
    }

    await this.storeLastPayload(payload);
    await this.broadcastToConnections(payload);
    return new Response(null, { status: 202 });
  }

  async storeLastPayload(payload) {
    this.lastBroadcast = payload;
    try {
      await this.state.storage.put(LAST_BROADCAST_KEY, payload);
    } catch (error) {
      console.error('Failed to persist live match payload', error);
    }
  }

  async broadcastToConnections(payload) {
    const message = JSON.stringify(payload);
    const staleConnections = [];

    for (const [id, socket] of this.connections.entries()) {
      try {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(message);
        } else if (socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) {
          staleConnections.push(id);
        }
      } catch (error) {
        staleConnections.push(id);
      }
    }

    for (const id of staleConnections) {
      this.connections.delete(id);
    }
  }

  async ensureInitialPayload() {
    if (this.lastBroadcast?.match) {
      return this.lastBroadcast;
    }

    const match = await this.loadMatchFromDatabase();
    if (!match) {
      return null;
    }

    const payload = { type: 'broadcastScore', match };
    await this.storeLastPayload(payload);
    return payload;
  }

  async loadMatchFromDatabase() {
    const matchName = this.state.id?.name;
    if (!matchName) {
      return null;
    }

    const matchId = Number.parseInt(matchName, 10);
    if (Number.isNaN(matchId)) {
      return null;
    }

    try {
      const db = getDatabase(this.env);
      const statement = db.prepare('SELECT * FROM matches WHERE id = ?').bind(matchId);
      const { results } = await statement.all();
      const row = results?.[0];
      return row ? deserializeMatchRow(row) : null;
    } catch (error) {
      console.error('Failed to load live match score from database', error);
      return null;
    }
  }
}
