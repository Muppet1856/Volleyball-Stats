import { methodNotAllowed } from './responses.js';
import { callStatsDurableObject } from './storage.js';

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
    return await callStatsDurableObject(env, '/players', { method: 'GET' });
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
    return await callStatsDurableObject(env, '/players', {
      method: 'POST',
      body: { number, lastName, initial }
    });
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
    return await callStatsDurableObject(env, `/players/${id}`, {
      method: 'PUT',
      body: { number, lastName, initial }
    });
  } catch (error) {
    console.error('Failed to update player', error);
    return Response.json({ error: 'Failed to update player' }, { status: 500 });
  }
}

async function deletePlayer(env, id) {
  try {
    return await callStatsDurableObject(env, `/players/${id}`, { method: 'DELETE' });
  } catch (error) {
    console.error('Failed to delete player', error);
    return Response.json({ error: 'Failed to delete player' }, { status: 500 });
  }
}
