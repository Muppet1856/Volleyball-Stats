import { methodNotAllowed } from './responses.js';
import { deserializeMatchRow, normalizeMatchPayload } from './matches/utils.js';
import { getDatabase } from './database.js';

export function routeMatches(request, env) {
  switch (request.method.toUpperCase()) {
    case 'GET':
      return listMatches(env);
    case 'POST':
      return createMatch(request, env);
    default:
      return methodNotAllowed(['GET', 'POST']);
  }
}

export function routeMatchById(request, env, id) {
  switch (request.method.toUpperCase()) {
    case 'GET':
      return getMatch(env, id);
    case 'PUT':
      return updateMatch(request, env, id);
    case 'DELETE':
      return deleteMatch(env, id);
    default:
      return methodNotAllowed(['GET', 'PUT', 'DELETE']);
  }
}

export function routeMatchTransitions(request, env, id) {
  if (request.method.toUpperCase() !== 'POST') {
    return methodNotAllowed(['POST']);
  }
  return forwardMatchRoom(request, env, id, '/transitions');
}

async function listMatches(env) {
  try {
    const db = getDatabase(env);
    const statement = db.prepare(
      'SELECT id, date, opponent FROM matches ORDER BY date ASC, opponent ASC, id ASC'
    );
    const { results } = await statement.all();
    return Response.json(results || []);
  } catch (error) {
    console.error('Failed to fetch matches', error);
    return Response.json({ error: 'Failed to fetch matches' }, { status: 500 });
  }
}

async function createMatch(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (error) {
    return Response.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const payload = normalizeMatchPayload(body);
  try {
    const db = getDatabase(env);
    const statement = db.prepare(
      `INSERT INTO matches (
        date,
        location,
        types,
        opponent,
        jersey_color_sc,
        jersey_color_opp,
        result_sc,
        result_opp,
        first_server,
        players,
        sets,
        finalized_sets,
        is_swapped,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
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
      new Date().toISOString()
    );
    const result = await statement.run();
    const id = result?.meta?.last_row_id;
    return Response.json({ id }, { status: 201 });
  } catch (error) {
    console.error('Failed to create match', error);
    return Response.json({ error: 'Failed to create match' }, { status: 500 });
  }
}

async function getMatch(env, id) {
  try {
    const db = getDatabase(env);
    const statement = db.prepare(
      'SELECT * FROM matches WHERE id = ?'
    ).bind(id);
    const { results } = await statement.all();
    const row = results?.[0];
    if (!row) {
      return Response.json({ error: 'Match not found' }, { status: 404 });
    }
    return Response.json(deserializeMatchRow(row));
  } catch (error) {
    console.error('Failed to fetch match', error);
    return Response.json({ error: 'Failed to fetch match' }, { status: 500 });
  }
}

async function updateMatch(request, env, id) {
  return forwardMatchRoom(request, env, id, '/state');
}

async function deleteMatch(env, id) {
  try {
    const db = getDatabase(env);
    const result = await db.prepare(
      'DELETE FROM matches WHERE id = ?'
    ).bind(id).run();
    if (!result?.meta || result.meta.changes === 0) {
      return Response.json({ error: 'Match not found' }, { status: 404 });
    }
    await notifyMatchRoomOfDeletion(env, id);
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('Failed to delete match', error);
    return Response.json({ error: 'Failed to delete match' }, { status: 500 });
  }
}

function getMatchRoomNamespace(env) {
  return (
    env?.MATCH_ROOMS ??
    env?.matchRooms ??
    env?.match_rooms ??
    env?.MatchRooms ??
    env?.matchrooms ??
    null
  );
}

function getMatchRoomStub(env, id) {
  const namespace = getMatchRoomNamespace(env);
  if (!namespace || typeof namespace.idFromName !== 'function' || typeof namespace.get !== 'function') {
    return null;
  }
  try {
    const durableId = namespace.idFromName(String(id));
    return namespace.get(durableId);
  } catch (error) {
    console.error('Failed to resolve MatchRoom stub', error);
    return null;
  }
}

async function forwardMatchRoom(request, env, id, path) {
  const stub = getMatchRoomStub(env, id);
  if (!stub) {
    console.error('Missing MatchRoom Durable Object binding');
    return Response.json({ error: 'Match synchronization service unavailable' }, { status: 500 });
  }
  const targetUrl = `https://match-room.internal${path}`;
  let response;
  try {
    response = await stub.fetch(new Request(targetUrl, request));
  } catch (error) {
    console.error('Failed to reach MatchRoom Durable Object', error);
    return Response.json({ error: 'Failed to update match' }, { status: 500 });
  }
  const headers = new Headers(response.headers);
  return new Response(response.body, {
    status: response.status,
    headers
  });
}

async function notifyMatchRoomOfDeletion(env, id) {
  const stub = getMatchRoomStub(env, id);
  if (!stub) {
    return;
  }
  try {
    await stub.fetch('https://match-room.internal/state', { method: 'DELETE' });
  } catch (error) {
    console.warn('Failed to notify MatchRoom of deletion', error);
  }
}
