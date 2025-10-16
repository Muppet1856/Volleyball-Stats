import { deserializeMatchRow, normalizeMatchPayload } from './utils.js';

export async function onRequest(context) {
  const { request, env, params } = context;
  const id = Number.parseInt(params.id, 10);
  if (!Number.isInteger(id)) {
    return Response.json({ error: 'Invalid match id' }, { status: 400 });
  }

  switch (request.method.toUpperCase()) {
    case 'GET':
      return handleGetMatch(env, id);
    case 'PUT':
      return handleUpdateMatch(request, env, id);
    case 'DELETE':
      return handleDeleteMatch(env, id);
    default:
      return methodNotAllowed(['GET', 'PUT', 'DELETE']);
  }
}

function methodNotAllowed(allowed) {
  return new Response('Method Not Allowed', {
    status: 405,
    headers: { 'Allow': allowed.join(', ') }
  });
}

async function handleGetMatch(env, id) {
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

async function handleUpdateMatch(request, env, id) {
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

async function handleDeleteMatch(env, id) {
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
