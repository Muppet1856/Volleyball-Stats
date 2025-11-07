import { methodNotAllowed } from './responses.js';
import { getDatabase } from './database.js';

export function routeSets(request, env) {
  switch (request.method.toUpperCase()) {
    case 'GET':
      return listMatchSets(request, env);
    case 'POST':
      return createSet(request, env);
    default:
      return methodNotAllowed(['GET', 'POST']);
  }
}

export function routeSetById(request, env, id) {
  switch (request.method.toUpperCase()) {
    case 'PUT':
      return updateSet(request, env, id);
    case 'DELETE':
      return deleteSet(env, id);
    default:
      return methodNotAllowed(['PUT', 'DELETE']);
  }
}

async function listMatchSets(request, env) {
  const url = new URL(request.url);
  const rawMatchID =
    url.searchParams.get('matchID') ?? url.searchParams.get('matchId') ?? undefined;

  if (rawMatchID === null || rawMatchID === undefined || rawMatchID === '') {
    return Response.json({ error: 'Missing required field: matchID' }, { status: 400 });
  }

  const matchID = Number(rawMatchID);

  if (!Number.isInteger(matchID)) {
    return Response.json({ error: 'Field "matchID" must be an integer' }, { status: 400 });
  }

  if (!matchID) {
    return Response.json({ error: 'Match ID required' }, { status: 400 });
  }
  try {
    const db = getDatabase(env);
    const statement = db.prepare(
      'SELECT id, match_id, set_number, set_score_home, set_score_opp FROM sets WHERE match_id = ? ORDER BY match_id ASC, set_number ASC, id ASC'
    ).bind(matchID);
    const { results } = await statement.all();
    return Response.json(results || []);
  } catch (error) {
    console.error('Failed to fetch sets', error);
    return Response.json({ error: 'Failed to fetch sets' }, { status: 500 });
  }
}

async function createSet(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (error) {
    return Response.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const rawMatchID = body?.matchID;
  const rawSetNumber = body?.setNumber;
  const rawSetScoreHome = body?.setScoreHome;
  const rawSetScoreOpp = body?.setScoreOpp;
  let matchID;
  let setNumber;
  let setScoreHome;
  let setScoreOpp;

  if (rawMatchID === null || rawMatchID === undefined || rawMatchID === '') {
    return Response.json({ error: 'Missing required field: matchID' }, { status: 400 });
  }
  if (rawSetNumber === null || rawSetNumber === undefined || rawSetNumber === '') {
    return Response.json({ error: 'Missing required field: setNumber' }, { status: 400 });
  }
  if (rawSetScoreHome === null || rawSetScoreHome === undefined || rawSetScoreHome === '') {
    return Response.json({ error: 'Missing required field: setScoreHome' }, { status: 400 });
  }
  if (rawSetScoreOpp === null || rawSetScoreOpp === undefined || rawSetScoreOpp === '') {
    return Response.json({ error: 'Missing required field: setScoreOpp' }, { status: 400 });
  }

  matchID = Number(rawMatchID);
  setNumber = Number(rawSetNumber);
  setScoreHome = Number(rawSetScoreHome);
  setScoreOpp = Number(rawSetScoreOpp);

  if (!Number.isInteger(matchID)) {
    return Response.json({ error: 'Field "matchID" must be an integer' }, { status: 400 });
  }
  if (!Number.isInteger(setNumber)) {
    return Response.json({ error: 'Field "setNumber" must be an integer' }, { status: 400 });
  }
  if (!Number.isInteger(setScoreHome)) {
    return Response.json({ error: 'Field "setScoreHome" must be an integer' }, { status: 400 });
  }
  if (!Number.isInteger(setScoreOpp)) {
    return Response.json({ error: 'Field "setScoreOpp" must be an integer' }, { status: 400 });
  }

  if (!matchID || !setNumber) {
    return Response.json({ error: 'Set number and match ID required' }, { status: 400 });
  }

  try {
    const db = getDatabase(env);
    const statement = db.prepare(
      'INSERT INTO sets (match_id, set_number, set_score_home, set_score_opp) VALUES (?, ?, ?, ?)'
    ).bind(matchID, setNumber, setScoreHome, setScoreOpp);
    const result = await statement.run();
    const id = result?.meta?.last_row_id;
    if (!id) {
      throw new Error('Failed to determine inserted ID');
    }

    const { results } = await db
      .prepare(
        'SELECT id, match_id, set_number, set_score_home, set_score_opp FROM sets WHERE id = ?'
      )
      .bind(id)
      .all();

    const row = results?.[0];

    return Response.json(row ?? { id, match_id: matchID, set_number: setNumber, set_score_home: setScoreHome, set_score_opp: setScoreOpp }, { status: 201 });
  } catch (error) {
    console.error('Failed to create set', error);
    return Response.json({ error: 'Failed to create set' }, { status: 500 });
  }
}

async function updateSet(request, env, id) {
  let body;
  try {
    body = await request.json();
  } catch (error) {
    return Response.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const rawMatchID = body?.matchID;
  const rawSetNumber = body?.setNumber;
  const rawSetScoreHome = body?.setScoreHome;
  const rawSetScoreOpp = body?.setScoreOpp;
  let matchID;
  let setNumber;
  let setScoreHome;
  let setScoreOpp;

  if (rawMatchID === null || rawMatchID === undefined || rawMatchID === '') {
    return Response.json({ error: 'Missing required field: matchID' }, { status: 400 });
  }
  if (rawSetNumber === null || rawSetNumber === undefined || rawSetNumber === '') {
    return Response.json({ error: 'Missing required field: setNumber' }, { status: 400 });
  }
  if (rawSetScoreHome === null || rawSetScoreHome === undefined || rawSetScoreHome === '') {
    return Response.json({ error: 'Missing required field: setScoreHome' }, { status: 400 });
  }
  if (rawSetScoreOpp === null || rawSetScoreOpp === undefined || rawSetScoreOpp === '') {
    return Response.json({ error: 'Missing required field: setScoreOpp' }, { status: 400 });
  }

  matchID = Number(rawMatchID);
  setNumber = Number(rawSetNumber);
  setScoreHome = Number(rawSetScoreHome);
  setScoreOpp = Number(rawSetScoreOpp);

  if (!Number.isInteger(matchID)) {
    return Response.json({ error: 'Field "matchID" must be an integer' }, { status: 400 });
  }
  if (!Number.isInteger(setNumber)) {
    return Response.json({ error: 'Field "setNumber" must be an integer' }, { status: 400 });
  }
  if (!Number.isInteger(setScoreHome)) {
    return Response.json({ error: 'Field "setScoreHome" must be an integer' }, { status: 400 });
  }
  if (!Number.isInteger(setScoreOpp)) {
    return Response.json({ error: 'Field "setScoreOpp" must be an integer' }, { status: 400 });
  }

  if (!matchID || !setNumber) {
    return Response.json({ error: 'Set number and match ID required' }, { status: 400 });
  }

  try {
    const db = getDatabase(env);
    const statement = db.prepare(
      'UPDATE sets SET match_id = ?, set_number = ?, set_score_home = ?, set_score_opp = ? WHERE id = ?'
    ).bind(matchID, setNumber, setScoreHome, setScoreOpp, id);
    const result = await statement.run();
    if (!result?.meta || result.meta.changes === 0) {
      return Response.json({ error: 'Set not found' }, { status: 404 });
    }

    const { results } = await db
      .prepare(
        'SELECT id, match_id, set_number, set_score_home, set_score_opp FROM sets WHERE id = ?'
      )
      .bind(id)
      .all();

    const row = results?.[0];
    if (!row) {
      return Response.json({ error: 'Set not found' }, { status: 404 });
    }

    return Response.json(row);
  } catch (error) {
    console.error('Failed to update set', error);
    return Response.json({ error: 'Failed to update set' }, { status: 500 });
  }
}

async function deleteSet(env, id) {
  try {
    const db = getDatabase(env);
    const result = await db.prepare(
      'DELETE FROM sets WHERE id = ?'
    ).bind(id).run();
    if (!result?.meta || result.meta.changes === 0) {
      return Response.json({ error: 'Set not found' }, { status: 404 });
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('Failed to delete set', error);
    return Response.json({ error: 'Failed to delete set' }, { status: 500 });
  }
}
