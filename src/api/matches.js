import { methodNotAllowed } from './responses.js';
import { deserializeMatchRow, normalizeMatchPayload } from './matches/utils.js';

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

async function listMatches(env) {
  try {
    const statement = env.VOLLEYBALL_STATS_DB.prepare(
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
    const statement = env.VOLLEYBALL_STATS_DB.prepare(
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
        is_swapped
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      payload.isSwapped ? 1 : 0
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
    const statement = env.VOLLEYBALL_STATS_DB.prepare(
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
  let body;
  try {
    body = await request.json();
  } catch (error) {
    return Response.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }
  const payload = normalizeMatchPayload(body);
  try {
    const statement = env.VOLLEYBALL_STATS_DB.prepare(
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
        is_swapped = ?
      WHERE id = ?`
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
      id
    );
    const result = await statement.run();
    if (!result?.meta || result.meta.changes === 0) {
      return Response.json({ error: 'Match not found' }, { status: 404 });
    }
    return Response.json({ id });
  } catch (error) {
    console.error('Failed to update match', error);
    return Response.json({ error: 'Failed to update match' }, { status: 500 });
  }
}

async function deleteMatch(env, id) {
  try {
    const result = await env.VOLLEYBALL_STATS_DB.prepare(
      'DELETE FROM matches WHERE id = ?'
    ).bind(id).run();
    if (!result?.meta || result.meta.changes === 0) {
      return Response.json({ error: 'Match not found' }, { status: 404 });
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('Failed to delete match', error);
    return Response.json({ error: 'Failed to delete match' }, { status: 500 });
  }
}
