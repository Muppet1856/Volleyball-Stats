import { normalizeMatchPayload } from './utils.js';

export async function onRequest(context) {
  const { request, env } = context;
  switch (request.method.toUpperCase()) {
    case 'GET':
      return handleListMatches(env);
    case 'POST':
      return handleCreateMatch(request, env);
    default:
      return methodNotAllowed(['GET', 'POST']);
  }
}

function methodNotAllowed(allowed) {
  return new Response('Method Not Allowed', {
    status: 405,
    headers: { 'Allow': allowed.join(', ') }
  });
}

async function handleListMatches(env) {
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

async function handleCreateMatch(request, env) {
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
