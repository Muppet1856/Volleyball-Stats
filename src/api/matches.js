import { methodNotAllowed } from './responses.js';
import {
  deserializeMatchRow,
  normalizeMatchPayload,
  serializeMatchSets
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
  try {
    const db = getDatabase(env);
    await db.prepare('BEGIN TRANSACTION').run();
    try {
      const insertMatch = db
        .prepare(
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
            is_swapped
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
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
          payload.isSwapped ? 1 : 0
        );
      const result = await insertMatch.run();
      const id = result?.meta?.last_row_id;

      if (!id) {
        throw new Error('Failed to determine created match id');
      }

      const setRows = serializeMatchSets(payload.sets, payload.finalizedSets);
      const insertSet = db.prepare(
        `INSERT INTO match_sets (
          match_id,
          set_number,
          sc_score,
          opp_score,
          sc_timeout_1,
          sc_timeout_2,
          opp_timeout_1,
          opp_timeout_2,
          finalized
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      for (const row of setRows) {
        await insertSet
          .bind(
            id,
            row.setNumber,
            row.scScore,
            row.oppScore,
            row.scTimeout1,
            row.scTimeout2,
            row.oppTimeout1,
            row.oppTimeout2,
            row.finalized
          )
          .run();
      }

      await db.prepare('COMMIT').run();
      return Response.json({ id }, { status: 201 });
    } catch (error) {
      await db.prepare('ROLLBACK').run().catch(() => {});
      throw error;
    }
  } catch (error) {
    console.error('Failed to create match', error);
    return Response.json({ error: 'Failed to create match' }, { status: 500 });
  }
}

async function getMatch(env, id) {
  try {
    const db = getDatabase(env);
    const statement = db.prepare('SELECT * FROM matches WHERE id = ?').bind(id);
    const { results } = await statement.all();
    const row = results?.[0];
    if (!row) {
      return Response.json({ error: 'Match not found' }, { status: 404 });
    }
    const { results: setRows } = await db
      .prepare(
        `SELECT
          set_number,
          sc_score,
          opp_score,
          sc_timeout_1,
          sc_timeout_2,
          opp_timeout_1,
          opp_timeout_2,
          finalized
        FROM match_sets
        WHERE match_id = ?
        ORDER BY set_number ASC`
      )
      .bind(id)
      .all();
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
    await db.prepare('BEGIN TRANSACTION').run();
    try {
      const statement = db
        .prepare(
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
            is_swapped = ?
          WHERE id = ?`
        )
        .bind(
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
          payload.isSwapped ? 1 : 0,
          id
        );
      const result = await statement.run();
      if (!result?.meta || result.meta.changes === 0) {
        await db.prepare('ROLLBACK').run().catch(() => {});
        return Response.json({ error: 'Match not found' }, { status: 404 });
      }

      await db
        .prepare('DELETE FROM match_sets WHERE match_id = ?')
        .bind(id)
        .run();

      const setRows = serializeMatchSets(payload.sets, payload.finalizedSets);
      const insertSet = db.prepare(
        `INSERT INTO match_sets (
          match_id,
          set_number,
          sc_score,
          opp_score,
          sc_timeout_1,
          sc_timeout_2,
          opp_timeout_1,
          opp_timeout_2,
          finalized
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      for (const row of setRows) {
        await insertSet
          .bind(
            id,
            row.setNumber,
            row.scScore,
            row.oppScore,
            row.scTimeout1,
            row.scTimeout2,
            row.oppTimeout1,
            row.oppTimeout2,
            row.finalized
          )
          .run();
      }

      await db.prepare('COMMIT').run();
      return Response.json({ id });
    } catch (error) {
      await db.prepare('ROLLBACK').run().catch(() => {});
      throw error;
    }
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
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('Failed to delete match', error);
    return Response.json({ error: 'Failed to delete match' }, { status: 500 });
  }
}
