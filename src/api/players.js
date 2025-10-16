import { methodNotAllowed } from './responses.js';
import { getDatabase } from './database.js';

export function routePlayers(request, env) {
  switch (request.method.toUpperCase()) {
    case 'GET':
      return listPlayers(env);
    case 'POST':
      return createPlayer(request, env);
    default:
      return methodNotAllowed(['GET', 'POST']);
  }
}

export function routePlayerById(request, env, id) {
  switch (request.method.toUpperCase()) {
    case 'PUT':
      return updatePlayer(request, env, id);
    case 'DELETE':
      return deletePlayer(env, id);
    default:
      return methodNotAllowed(['PUT', 'DELETE']);
  }
}

async function listPlayers(env) {
  try {
    const db = getDatabase(env);
    const statement = db.prepare(
      'SELECT id, number, last_name AS lastName, initial FROM players ORDER BY CAST(number AS INTEGER) ASC, last_name ASC, id ASC'
    );
    const { results } = await statement.all();
    return Response.json(results || []);
  } catch (error) {
    console.error('Failed to fetch players', error);
    return Response.json({ error: 'Failed to fetch players' }, { status: 500 });
  }
}

async function createPlayer(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (error) {
    return Response.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const number = String(body?.number ?? '').trim();
  const lastName = String(body?.lastName ?? '').trim();
  const initial = String(body?.initial ?? '').trim();

  if (!number || !lastName) {
    return Response.json({ error: 'Player number and last name are required' }, { status: 400 });
  }

  try {
    const db = getDatabase(env);
    const statement = db.prepare(
      'INSERT INTO players (number, last_name, initial) VALUES (?, ?, ?)'
    ).bind(number, lastName, initial);
    const result = await statement.run();
    const id = result?.meta?.last_row_id;
    return Response.json({ id, number, lastName, initial }, { status: 201 });
  } catch (error) {
    console.error('Failed to create player', error);
    return Response.json({ error: 'Failed to create player' }, { status: 500 });
  }
}

async function updatePlayer(request, env, id) {
  let body;
  try {
    body = await request.json();
  } catch (error) {
    return Response.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const number = String(body?.number ?? '').trim();
  const lastName = String(body?.lastName ?? '').trim();
  const initial = String(body?.initial ?? '').trim();

  if (!number || !lastName) {
    return Response.json({ error: 'Player number and last name are required' }, { status: 400 });
  }

  try {
    const db = getDatabase(env);
    const statement = db.prepare(
      'UPDATE players SET number = ?, last_name = ?, initial = ? WHERE id = ?'
    ).bind(number, lastName, initial, id);
    const result = await statement.run();
    if (!result?.meta || result.meta.changes === 0) {
      return Response.json({ error: 'Player not found' }, { status: 404 });
    }
    return Response.json({ id, number, lastName, initial });
  } catch (error) {
    console.error('Failed to update player', error);
    return Response.json({ error: 'Failed to update player' }, { status: 500 });
  }
}

async function deletePlayer(env, id) {
  try {
    const db = getDatabase(env);
    const result = await db.prepare(
      'DELETE FROM players WHERE id = ?'
    ).bind(id).run();
    if (!result?.meta || result.meta.changes === 0) {
      return Response.json({ error: 'Player not found' }, { status: 404 });
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('Failed to delete player', error);
    return Response.json({ error: 'Failed to delete player' }, { status: 500 });
  }
}
