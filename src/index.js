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

export class MatchState {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }
  
  async fetch(request) {
    const url = new URL(request.url);
    const matchId = url.searchParams.get('matchId');
    
    if (url.pathname === 'get-score' && matchId) {
      // Fetch live score from DO storage
      const score = await this.state.storage.get('score') || { home: 0, away: 0 };
      return new Response(JSON.stringify(score), { headers: { 'Content-Type': 'application/json' } });
    }
    
    if (url.pathname === '/update-score' && matchId) {
      // Update score (atomic, consistent)
      const newScore = await request.json();
      await this.state.storage.put('score', newScore);
      return new Response('Score updated', { status: 200 });
    }

    return new Response('Not found', { status: 404 });
  }
}

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
