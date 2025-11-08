import { getMatchStore } from './match-store.js';

const MATCH_STORE_ENDPOINT = 'https://match-store';

export async function sendMatchStoreRequest(env, op, payload = {}) {
  const store = getMatchStore(env);

  return store.fetch(MATCH_STORE_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ op, payload })
  });
}

export async function translateStoreResponse(response, { transformJson } = {}) {
  const headers = new Headers(response.headers);

  if (response.status === 204) {
    return new Response(null, {
      status: response.status,
      headers
    });
  }

  const contentType = headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    const json = await response.json();
    const transformed = typeof transformJson === 'function'
      ? transformJson(json, response.status)
      : json;

    headers.delete('content-type');

    return Response.json(transformed, {
      status: response.status,
      headers
    });
  }

  const text = await response.text();

  return new Response(text, {
    status: response.status,
    headers
  });
}
