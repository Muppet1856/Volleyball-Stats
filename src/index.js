import { methodNotAllowed, notFound } from './api/responses.js';
import { routeMatchById, routeMatches } from './api/matches.js';
import { routePlayerById, routePlayers } from './api/players.js';

const MATCH_ID_PATTERN = /^\/api\/matches\/(\d+)$/;
const PLAYER_ID_PATTERN = /^\/api\/players\/(\d+)$/;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      return handleApiRequest(request, env, url.pathname);
    }

    return env.ASSETS.fetch(request);
  }
};

export { VolleyballStatsDurableObject } from './durable/volleyball-stats.js';

function handleApiRequest(request, env, pathname) {
  if (pathname === '/api/matches') {
    return routeMatches(request, env);
  }

  if (pathname === '/api/config') {
    if (request.method.toUpperCase() !== 'GET') {
      return methodNotAllowed(['GET']);
    }
    const homeTeam = (env?.HOME_TEAM ?? 'Home Team').toString();
    return Response.json({ homeTeam });
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
