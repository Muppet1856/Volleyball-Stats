import { methodNotAllowed } from './responses.js';
import { deserializeMatchRow, normalizeMatchPayload } from './matches/utils.js';
import { sendMatchStoreRequest, translateStoreResponse } from './match-store-client.js';

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
    const response = await sendMatchStoreRequest(env, 'LIST_MATCHES');
    return await translateStoreResponse(response);
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
    const response = await sendMatchStoreRequest(env, 'CREATE_MATCH', payload);
    return await translateStoreResponse(response);
  } catch (error) {
    console.error('Failed to create match', error);
    return Response.json({ error: 'Failed to create match' }, { status: 500 });
  }
}

async function getMatch(env, id) {
  try {
    const response = await sendMatchStoreRequest(env, 'GET_MATCH', { id });
    return await translateStoreResponse(response, {
      transformJson(json, status) {
        if (status >= 200 && status < 300) {
          return deserializeMatchRow(json);
        }
        return json;
      }
    });
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
    const response = await sendMatchStoreRequest(env, 'UPDATE_MATCH', {
      id,
      ...payload
    });
    return await translateStoreResponse(response);
  } catch (error) {
    console.error('Failed to update match', error);
    return Response.json({ error: 'Failed to update match' }, { status: 500 });
  }
}

async function deleteMatch(env, id) {
  try {
    const response = await sendMatchStoreRequest(env, 'DELETE_MATCH', { id });
    return await translateStoreResponse(response);
  } catch (error) {
    console.error('Failed to delete match', error);
    return Response.json({ error: 'Failed to delete match' }, { status: 500 });
  }
}
