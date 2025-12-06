import jwt from '@tsndr/cloudflare-worker-jwt';
import { AUTH_COOKIE_NAME, extractTokenFromRequest } from './api/helpers';
import { Env } from './env';

const AUTH_DEBUG_PREFIX = '[auth-guard]';
export const PROTECTED_PREFIXES = ['/main', '/scorekeeper', '/follower'];

export async function getUserWithRoles(db: D1Database, userId: string) {
  const user = await db.prepare('SELECT id, email, name, verified FROM users WHERE id = ?').bind(userId).first();
  if (!user) return null;
  const { results: roles } = await db.prepare('SELECT role, org_id, team_id FROM user_roles WHERE user_id = ?').bind(userId).all();
  return { ...user, roles };
}

export type AuthedUser = Awaited<ReturnType<typeof getUserWithRoles>>;

export function pathRequiresAuth(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function buildUnauthorizedResponse(target: string, origin: string): Response {
  const redirect = `/?redirect=${encodeURIComponent(target || '/')}`;
  return new Response(JSON.stringify({ error: 'Unauthorized', redirect }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, no-store',
      'X-Auth-Checked': 'true',
      'X-Auth-Status': 'unauthorized',
    },
  });
}

export function buildLoginRedirectResponse(request: Request) {
  const url = new URL(request.url);
  const target = `${url.pathname}${url.search}`;
  return buildUnauthorizedResponse(target, url.origin);
}

export function logAuth(event: string, details: Record<string, unknown> = {}) {
  try {
    console.log(AUTH_DEBUG_PREFIX, event, JSON.stringify(details));
  } catch {
    console.log(AUTH_DEBUG_PREFIX, event, details);
  }
}

export async function getAuthorizedUser(request: Request, env: Env): Promise<AuthedUser | null> {
  const token = extractTokenFromRequest(request, AUTH_COOKIE_NAME);
  if (!token) {
    logAuth('missing-token', { path: new URL(request.url).pathname });
    return null;
  }

  try {
    if (!await jwt.verify(token, env.JWT_SECRET)) {
      logAuth('invalid-token', { path: new URL(request.url).pathname });
      return null;
    }
    const payload = jwt.decode(token).payload as { id?: string };
    if (!payload?.id) {
      logAuth('missing-id', { path: new URL(request.url).pathname });
      return null;
    }
    const user = await getUserWithRoles(env.DB, payload.id);
    if (!user) {
      logAuth('user-not-found', { userId: payload.id, path: new URL(request.url).pathname });
      return null;
    }
    logAuth('user-authenticated', { userId: payload.id, path: new URL(request.url).pathname });
    return user;
  } catch {
    logAuth('auth-error', { path: new URL(request.url).pathname });
    return null;
  }
}

export async function fetchProtectedAsset(c: any, env: Env) {
  const user = await getAuthorizedUser(c.req.raw, env);
  if (!user) {
    logAuth('asset-deny', { path: c.req.path, reason: 'no-user' });
    const url = new URL(c.req.url);
    const target = `${url.pathname}${url.search}`;
    return buildUnauthorizedResponse(target, url.origin);
  }
  const res = await env.ASSETS.fetch(c.req);
  const headers = new Headers(res.headers);
  headers.set('Cache-Control', 'private, no-store');
  headers.set('X-Auth-Checked', 'true');
  headers.set('X-Auth-Status', 'ok');
  headers.set('X-Auth-User', user.id || 'unknown');
  // Strip noisy permission headers added upstream
  headers.delete('Permissions-Policy');
  logAuth('asset-serve', { path: c.req.path, user: user.id || 'unknown' });
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}
