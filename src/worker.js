import { notFound, unauthorized } from './api/responses.js';
import { routeMatchById, routeMatches } from './api/matches.js';
import { routePlayerById, routePlayers } from './api/players.js';

const MATCH_ID_PATTERN = /^\/api\/matches\/(\d+)$/;
const PLAYER_ID_PATTERN = /^\/api\/players\/(\d+)$/;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      const authFailure = await authenticate(request, env);
      if (authFailure) {
        return authFailure;
      }

      return handleApiRequest(request, env, url.pathname);
    }

    return env.ASSETS.fetch(request);
  }
};

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

async function authenticate(request, env) {
  const expectedUsername = String(env.BASIC_AUTH_USERNAME || '').trim();
  const expectedPassword = String(env.BASIC_AUTH_PASSWORD || '').trim();

  if (!expectedUsername || !expectedPassword) {
    return null;
  }

  const authorization = request.headers.get('Authorization') || '';
  if (!authorization.startsWith('Basic ')) {
    return unauthorized();
  }

  const encodedCredentials = authorization.slice('Basic '.length);
  let decodedCredentials;
  try {
    decodedCredentials = atob(encodedCredentials);
  } catch (error) {
    console.warn('Failed to decode Authorization header', error);
    return unauthorized();
  }

  const separatorIndex = decodedCredentials.indexOf(':');
  if (separatorIndex === -1) {
    return unauthorized();
  }

  const providedUsername = decodedCredentials.slice(0, separatorIndex);
  const providedPassword = decodedCredentials.slice(separatorIndex + 1);

  const usernameMatches = await timingSafeEqual(providedUsername, expectedUsername);
  const passwordMatches = await timingSafeEqual(providedPassword, expectedPassword);

  if (!usernameMatches || !passwordMatches) {
    return unauthorized();
  }

  return null;
}

async function timingSafeEqual(a, b) {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);

  if (aBytes.length !== bBytes.length) {
    return false;
  }

  try {
    return await crypto.subtle.timingSafeEqual(aBytes, bBytes);
  } catch (error) {
    console.warn('Failed to perform timing safe comparison', error);
    return false;
  }
}
