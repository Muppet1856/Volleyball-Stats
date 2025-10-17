import { notFound } from './api/responses.js';
import { routeMatchById, routeMatches } from './api/matches.js';
import { routePlayerById, routePlayers } from './api/players.js';
import { LiveMatchDurableObject } from './live/liveMatch.js';

const MATCH_ID_PATTERN = /^\/api\/matches\/(\d+)$/;
const PLAYER_ID_PATTERN = /^\/api\/players\/(\d+)$/;
const LIVE_MATCH_PATTERN = /^\/live\/(\d+)$/;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (LIVE_MATCH_PATTERN.test(url.pathname)) {
      return handleLiveMatchRequest(request, env, url.pathname);
    }

    if (url.pathname.startsWith('/api/')) {
      return handleApiRequest(request, env, url.pathname);
    }

    return env.ASSETS.fetch(request);
  }
};

export { LiveMatchDurableObject };

function handleApiRequest(request, env, pathname) {
  if (pathname === '/api/matches') {
    return routeMatches(request, env);
  }

  const matchId = pathname.match(MATCH_ID_PATTERN);
  if (matchId) {
    return routeMatchById(request, env, Number.parseInt(matchId[1], 10));
  }

  if (pathname === '/api/players') {
    return routePlayers(request, env);
  }

  const playerId = pathname.match(PLAYER_ID_PATTERN);
  if (playerId) {
    return routePlayerById(request, env, Number.parseInt(playerId[1], 10));
  }

  return notFound();
}

async function handleLiveMatchRequest(request, env, pathname) {
  const matchId = pathname.match(LIVE_MATCH_PATTERN)?.[1];
  if (!matchId) {
    return notFound();
  }

  if (!env.LIVE_MATCH) {
    return Response.json({ error: 'Live updates not configured' }, { status: 501 });
  }

  if (request.headers.get('Upgrade') !== 'websocket') {
    return new Response('Expected WebSocket upgrade', { status: 426 });
  }

  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);

  const durableId = env.LIVE_MATCH.idFromName(matchId);
  const stub = env.LIVE_MATCH.get(durableId);

  try {
    await stub.fetch('https://live-match/connect', {
      headers: { Upgrade: 'websocket' },
      webSocket: server
    });
  } catch (error) {
    console.error('Failed to connect live match Durable Object', error);
    client.close(1011, 'Live updates unavailable');
    return new Response('Failed to establish live match connection', { status: 502 });
  }

  return new Response(null, { status: 101, webSocket: client });
}
