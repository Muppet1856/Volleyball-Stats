import { getDatabase } from './api/database.js';
import { deserializeMatchRow, normalizeMatchPayload } from './api/matches/utils.js';

const SNAPSHOT_STORAGE_KEY = 'snapshot';
const IDEMPOTENCY_STORAGE_KEY = 'idempotency';
const IDEMPOTENCY_CACHE_LIMIT = 20;

function sanitizeRevision(value, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isNaN(parsed)) {
      return Math.max(0, parsed);
    }
  }
  return fallback;
}

function buildUpdateBindings(payload, revision, id) {
  return [
    payload.date,
    payload.location,
    JSON.stringify(payload.types),
    payload.opponent,
    payload.jerseyColorSC,
    payload.jerseyColorOpp,
    payload.resultSC,
    payload.resultOpp,
    payload.firstServer,
    JSON.stringify(payload.players),
    JSON.stringify(payload.sets),
    JSON.stringify(payload.finalizedSets),
    payload.isSwapped ? 1 : 0,
    revision,
    id
  ];
}

function createResponse(body, { status = 200, headers } = {}) {
  const responseHeaders = new Headers(headers || { 'content-type': 'application/json' });
  if (!responseHeaders.has('content-type')) {
    responseHeaders.set('content-type', 'application/json');
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders
  });
}

export class MatchRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.snapshot = null;
    this.snapshotLoaded = false;
    this.idempotencyCache = null;
    this.idempotencyLoaded = false;
  }

  async fetch(request) {
    const url = new URL(request.url);
    switch (request.method.toUpperCase()) {
      case 'POST': {
        if (url.pathname === '/transitions') {
          return this.handleTransition(request);
        }
        break;
      }
      case 'PUT': {
        if (url.pathname === '/state') {
          return this.handleLegacySave(request);
        }
        break;
      }
      case 'DELETE': {
        if (url.pathname === '/state') {
          return this.handleDelete();
        }
        break;
      }
      default:
        break;
    }

    return new Response('Not found', { status: 404 });
  }

  async handleTransition(request) {
    let payload;
    try {
      payload = await request.json();
    } catch (error) {
      return createResponse({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    if (!payload || typeof payload !== 'object') {
      return createResponse({ error: 'Invalid transition payload' }, { status: 400 });
    }

    const idempotencyKey = typeof payload.idempotencyKey === 'string' ? payload.idempotencyKey.trim() : '';
    if (idempotencyKey) {
      const cached = await this.getCachedResponse(idempotencyKey);
      if (cached) {
        return createResponse(cached.body, { status: cached.status });
      }
    }

    const currentSnapshot = await this.getCurrentSnapshot();
    if (!currentSnapshot) {
      return createResponse({ error: 'Match not found' }, { status: 404 });
    }

    const expectedRevision = sanitizeRevision(this.extractRevision(payload.original), currentSnapshot.revision);
    if (expectedRevision !== currentSnapshot.revision) {
      return createResponse(
        {
          conflict: true,
          revision: currentSnapshot.revision,
          state: currentSnapshot.state,
          match: currentSnapshot.state,
          id: currentSnapshot.state?.id ?? this.getMatchId()
        },
        { status: 409 }
      );
    }

    const nextState = this.extractNextState(payload);
    if (!nextState) {
      return createResponse({ error: 'Missing transition payload' }, { status: 400 });
    }

    const result = await this.persistState(nextState, currentSnapshot.revision + 1);
    const status = result.conflict ? 409 : 200;
    if (!result.conflict && idempotencyKey) {
      await this.storeCachedResponse(idempotencyKey, { status, body: result });
    }
    return createResponse(result, { status });
  }

  async handleLegacySave(request) {
    let payload;
    try {
      payload = await request.json();
    } catch (error) {
      return createResponse({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    if (!payload || typeof payload !== 'object') {
      return createResponse({ error: 'Invalid match payload' }, { status: 400 });
    }

    const currentSnapshot = await this.getCurrentSnapshot();
    if (!currentSnapshot) {
      return createResponse({ error: 'Match not found' }, { status: 404 });
    }

    const providedRevision = sanitizeRevision(payload.revision, currentSnapshot.revision);
    if (providedRevision !== currentSnapshot.revision) {
      return createResponse(
        {
          conflict: true,
          revision: currentSnapshot.revision,
          state: currentSnapshot.state,
          match: currentSnapshot.state,
          id: currentSnapshot.state?.id ?? this.getMatchId()
        },
        { status: 409 }
      );
    }

    const result = await this.persistState(payload, currentSnapshot.revision + 1);
    const status = result.conflict ? 409 : 200;
    return createResponse(result, { status });
  }

  async handleDelete() {
    this.snapshot = null;
    this.snapshotLoaded = true;
    await Promise.all([
      this.state.storage.delete(SNAPSHOT_STORAGE_KEY),
      this.state.storage.delete(IDEMPOTENCY_STORAGE_KEY)
    ]);
    this.idempotencyCache = null;
    this.idempotencyLoaded = false;
    return new Response(null, { status: 204 });
  }

  async getCurrentSnapshot() {
    if (!this.snapshotLoaded) {
      const stored = await this.state.storage.get(SNAPSHOT_STORAGE_KEY);
      if (stored && typeof stored === 'object') {
        this.snapshot = stored;
      } else {
        const match = await this.loadFromDatabase();
        if (!match) {
          this.snapshot = null;
        } else {
          this.snapshot = {
            revision: match.revision ?? 0,
            state: match
          };
          await this.state.storage.put(SNAPSHOT_STORAGE_KEY, this.snapshot);
        }
      }
      this.snapshotLoaded = true;
    }
    return this.snapshot;
  }

  async loadFromDatabase() {
    const db = getDatabase(this.env);
    const id = this.getMatchId();
    const statement = db.prepare('SELECT * FROM matches WHERE id = ?').bind(id);
    const { results } = await statement.all();
    const row = results?.[0];
    if (!row) {
      return null;
    }
    return deserializeMatchRow(row);
  }

  async persistState(nextState, revision) {
    const id = this.getMatchId();
    const normalized = normalizeMatchPayload(nextState);
    const db = getDatabase(this.env);
    const statement = db.prepare(
      `UPDATE matches SET
        date = ?,
        location = ?,
        types = ?,
        opponent = ?,
        jersey_color_sc = ?,
        jersey_color_opp = ?,
        result_sc = ?,
        result_opp = ?,
        first_server = ?,
        players = ?,
        sets = ?,
        finalized_sets = ?,
        is_swapped = ?,
        revision = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`
    ).bind(...buildUpdateBindings(normalized, revision, id));

    const result = await statement.run();
    if (!result?.meta || result.meta.changes === 0) {
      const currentState = this.snapshot?.state ?? null;
      const currentRevision = this.snapshot?.revision ?? 0;
      return {
        conflict: true,
        revision: currentRevision,
        state: currentState,
        match: currentState,
        id
      };
    }

    const refreshed = await this.loadFromDatabase();
    const responsePayload = {
      conflict: false,
      revision: refreshed?.revision ?? revision,
      state: refreshed || {
        ...normalized,
        id,
        revision
      },
      match: refreshed || {
        ...normalized,
        id,
        revision
      },
      id
    };

    this.snapshot = {
      revision: responsePayload.revision,
      state: responsePayload.state
    };
    await this.state.storage.put(SNAPSHOT_STORAGE_KEY, this.snapshot);
    return responsePayload;
  }

  extractNextState(payload) {
    if (!payload || typeof payload !== 'object') {
      return null;
    }
    const candidates = [
      payload.next,
      payload.match,
      payload.state,
      payload.snapshot
    ];
    for (const candidate of candidates) {
      if (candidate && typeof candidate === 'object') {
        return candidate;
      }
    }
    return null;
  }

  extractRevision(source) {
    if (!source || typeof source !== 'object') {
      return undefined;
    }
    const candidates = [
      source.revision,
      source?.state?.revision,
      source?.match?.revision,
      source?.snapshot?.revision
    ];
    for (const candidate of candidates) {
      if (candidate !== undefined) {
        return candidate;
      }
    }
    return undefined;
  }

  async getCachedResponse(key) {
    if (!this.idempotencyLoaded) {
      const stored = await this.state.storage.get(IDEMPOTENCY_STORAGE_KEY);
      if (Array.isArray(stored)) {
        this.idempotencyCache = new Map(stored);
      } else {
        this.idempotencyCache = new Map();
      }
      this.idempotencyLoaded = true;
    }
    return this.idempotencyCache?.get(key) ?? null;
  }

  async storeCachedResponse(key, value) {
    if (!this.idempotencyLoaded) {
      await this.getCachedResponse(key);
    }
    if (!this.idempotencyCache) {
      this.idempotencyCache = new Map();
    }
    this.idempotencyCache.set(key, value);
    while (this.idempotencyCache.size > IDEMPOTENCY_CACHE_LIMIT) {
      const oldestKey = this.idempotencyCache.keys().next().value;
      this.idempotencyCache.delete(oldestKey);
    }
    await this.state.storage.put(
      IDEMPOTENCY_STORAGE_KEY,
      Array.from(this.idempotencyCache.entries())
    );
  }

  getMatchId() {
    const name = this.state.id.toString();
    const parsed = Number.parseInt(name, 10);
    return Number.isNaN(parsed) ? name : parsed;
  }
}
