import { methodNotAllowed } from './responses.js';
import {
  deserializeMatchRow,
  mapMatchPayloadToRow,
  mapMatchSetsToRows,
  normalizeMatchPayload
} from './matches/utils.js';
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
  let db;
  let createdMatchId;
  try {
    db = getDatabase(env);
    const row = mapMatchPayloadToRow(payload);
    const statement = db.prepare(
      `INSERT INTO matches (
        date,
        location,
        types,
        opponent,
        jersey_color_home,
        jersey_color_opp,
        result_home,
        result_opp,
        first_server,
        players,
        finalized_sets,
        is_swapped
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      row.date,
      row.location,
      row.types,
      row.opponent,
      row.jersey_color_home,
      row.jersey_color_opp,
      row.result_home,
      row.result_opp,
      row.first_server,
      row.players,
      row.finalized_sets,
      row.is_swapped
    );
    const result = await statement.run();
    const id = result?.meta?.last_row_id;
    if (!id) {
      throw new Error('Failed to determine match id');
    }
    createdMatchId = id;

    await replaceMatchSets(db, id, payload.sets);
    return Response.json({ id }, { status: 201 });
  } catch (error) {
    console.error('Failed to create match', error);
    if (createdMatchId && db) {
      try {
        await db.prepare('DELETE FROM match_sets WHERE match_id = ?').bind(createdMatchId).run();
        await db.prepare('DELETE FROM matches WHERE id = ?').bind(createdMatchId).run();
      } catch (cleanupError) {
        console.error('Failed to clean up partial match insert', cleanupError);
      }
    }
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
    const setStatement = db.prepare(
      `SELECT set_number, home_score, opp_score, home_timeout_1, home_timeout_2, opp_timeout_1, opp_timeout_2
       FROM match_sets
       WHERE match_id = ?
       ORDER BY set_number ASC`
    ).bind(id);
    const { results: setRows } = await setStatement.all();
    return Response.json(deserializeMatchRow(row, setRows || []));
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
    const db = getDatabase(env);
    const row = mapMatchPayloadToRow(payload);
    const statement = db.prepare(
      `UPDATE matches SET
        date = ?,
        location = ?,
        types = ?,
        opponent = ?,
        jersey_color_home = ?,
        jersey_color_opp = ?,
        result_home = ?,
        result_opp = ?,
        first_server = ?,
        players = ?,
        finalized_sets = ?,
        is_swapped = ?
      WHERE id = ?`
    ).bind(
      row.date,
      row.location,
      row.types,
      row.opponent,
      row.jersey_color_home,
      row.jersey_color_opp,
      row.result_home,
      row.result_opp,
      row.first_server,
      row.players,
      row.finalized_sets,
      row.is_swapped,
      id
    );
    const result = await statement.run();
    if (!result?.meta || result.meta.changes === 0) {
      return Response.json({ error: 'Match not found' }, { status: 404 });
    }
    await replaceMatchSets(db, id, payload.sets);
    return Response.json({ id });
  } catch (error) {
    console.error('Failed to update match', error);
    return Response.json({ error: 'Failed to update match' }, { status: 500 });
  }
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
    await db.prepare('DELETE FROM match_sets WHERE match_id = ?').bind(id).run();
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('Failed to delete match', error);
    return Response.json({ error: 'Failed to delete match' }, { status: 500 });
  }
}

async function replaceMatchSets(db, matchId, sets) {
  const rows = mapMatchSetsToRows(matchId, sets);
  for (const row of rows) {
    await db
      .prepare(
        `INSERT INTO match_sets (
          match_id,
          set_number,
          home_score,
          opp_score,
          home_timeout_1,
          home_timeout_2,
          opp_timeout_1,
          opp_timeout_2
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(match_id, set_number) DO UPDATE SET
          home_score = excluded.home_score,
          opp_score = excluded.opp_score,
          home_timeout_1 = excluded.home_timeout_1,
          home_timeout_2 = excluded.home_timeout_2,
          opp_timeout_1 = excluded.opp_timeout_1,
          opp_timeout_2 = excluded.opp_timeout_2`
      )
      .bind(
        row.matchId,
        row.setNumber,
        row.homeScore,
        row.oppScore,
        row.homeTimeout1,
        row.homeTimeout2,
        row.oppTimeout1,
        row.oppTimeout2
      )
      .run();
  }
}
