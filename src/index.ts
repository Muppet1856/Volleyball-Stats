// src/index.ts
import { Hono } from 'hono'
import auth from './api/auth';
import orgs from './api/orgs';
import teams from './api/teams';
import { AUTH_COOKIE_NAME, authMiddleware, extractTokenFromRequest } from './api/helpers';
import { buildUnauthorizedResponse, fetchProtectedAsset, getAuthorizedUser, logAuth, pathRequiresAuth } from './auth-guard';
import { MatchState } from './match-state';
import { Env } from './env';
import { errorResponse } from "./utils/responses";

export { MatchState };

const app = new Hono<{ Bindings: Env }>();
const api = new Hono<{ Bindings: Env }>();

// Apply auth middleware to protect everything (except login/verify) before mounting routers
api.use('*', authMiddleware);

// Require auth for UI pages that should not be publicly accessible
app.use('*', async (c, next) => {
  if (!pathRequiresAuth(c.req.path)) {
    return next();
  }

  const token = extractTokenFromRequest(c.req.raw, AUTH_COOKIE_NAME);
  if (!token) {
    logAuth('middleware-redirect', { path: c.req.path, reason: 'no-token' });
    const url = new URL(c.req.url);
    const target = `${url.pathname}${url.search}`;
    return buildUnauthorizedResponse(target, url.origin);
  }

  const user = await getAuthorizedUser(c.req.raw, c.env);
  if (!user) {
    logAuth('middleware-redirect', { path: c.req.path, reason: 'verify-failed' });
    const url = new URL(c.req.url);
    const target = `${url.pathname}${url.search}`;
    return buildUnauthorizedResponse(target, url.origin);
  }

  logAuth('middleware-pass', { path: c.req.path, user: user.id });
  c.set('user', user);
  return next();
});

// Explicit guards for protected static paths (defensive in case middleware is bypassed)
app.get('/main', (c) => fetchProtectedAsset(c, c.env));
app.get('/main/*', (c) => fetchProtectedAsset(c, c.env));
app.get('/scorekeeper', (c) => fetchProtectedAsset(c, c.env));
app.get('/scorekeeper/*', (c) => fetchProtectedAsset(c, c.env));
app.get('/follower', (c) => fetchProtectedAsset(c, c.env));
app.get('/follower/*', (c) => fetchProtectedAsset(c, c.env));
app.get('/main/', (c) => fetchProtectedAsset(c, c.env));
app.get('/scorekeeper/', (c) => fetchProtectedAsset(c, c.env));
app.get('/follower/', (c) => fetchProtectedAsset(c, c.env));

// Auth routes
api.route('/', auth);

// Mount other routers
api.route('/', orgs);
api.route('/', teams);

// Handle /api/config inside api router to apply auth
api.get('/config', (c) => {
  const homeTeam = c.env.HOME_TEAM || "Home Team";
  return c.json({ homeTeam });
});

// Mount API to app
app.route('/api', api);

// Silence Chrome DevTools probe
app.get('/.well-known/appspecific/com.chrome.devtools.json', (c) => c.json({}));

// Static assets fallback
app.get('*', async (c) => {
  try {
    const res = await c.env.ASSETS.fetch(c.req);
    return res;
  } catch {
    // Asset fetch errors bubble so Cloudflare still reports them
    return c.text('Internal Server Error', 500);
  }
});

/* -------------------------------------------------
   Top-level fetch - static files + DO routing
   ------------------------------------------------- */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (pathRequiresAuth(path)) {
      const user = await getAuthorizedUser(request, env);
      if (!user) {
        logAuth('top-level-redirect', { path });
        const target = `${url.pathname}${url.search}`;
        return buildUnauthorizedResponse(target, url.origin);
      }
      logAuth('top-level-pass', { path, user: user.id || 'unknown' });
    }

    if (path.startsWith("/ws")) {
      try {
        const doId = env.Match_DO.idFromName("global");
        const doStub = env.Match_DO.get(doId);
        return await doStub.fetch(request);
      } catch (e) {
        return errorResponse(`DO fetch failed: ${(e as Error).message}`, 500);
      }
    }

    return app.fetch(request, env, ctx);
  },
};
