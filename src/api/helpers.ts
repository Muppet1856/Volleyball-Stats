import { Context } from 'hono';
import { z } from 'zod';
import jwt from '@tsndr/cloudflare-worker-jwt';

export const AUTH_COOKIE_NAME = 'auth_token';

type Bindings = {
  DB: D1Database;
  JWT_SECRET: string;
  RESEND_API_KEY: string;
  ASSETS: Fetcher;
};

function getCookieToken(cookieHeader: string | null, name: string = AUTH_COOKIE_NAME): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) {
      return decodeURIComponent(trimmed.slice(name.length + 1));
    }
  }
  return null;
}

export function extractTokenFromRequest(req: Request, cookieName: string = AUTH_COOKIE_NAME): string | null {
  const authHeader = req.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  const cookieToken = getCookieToken(req.headers.get('Cookie'), cookieName);
  if (cookieToken) return cookieToken;
  return null;
}

export async function getUserWithRoles(db: D1Database, userId: string) {
  const user = await db.prepare('SELECT id, email, name, verified FROM users WHERE id = ?').bind(userId).first();
  if (!user) return null;
  const { results: roles } = await db.prepare('SELECT role, org_id, team_id FROM user_roles WHERE user_id = ?').bind(userId).all();
  return { ...user, roles };
}

export function isMainAdmin(roles: any[]) {
  return roles.some(r => r.role === 'main_admin');
}

export function isOrgAdminForOrg(roles: any[], orgId: string) {
  return isMainAdmin(roles) || roles.some(r => r.role === 'org_admin' && r.org_id === orgId);
}

export function isTeamAdminForTeam(roles: any[], teamId: string) {
  return isMainAdmin(roles) || roles.some(r => r.role === 'team_admin' && r.team_id === teamId);
}

export async function authMiddleware(c: Context<{ Bindings: Bindings }>, next: () => Promise<void>) {
  const path = c.req.path.replace(/^\/api/, '');
  if (path === '/login' || path === '/verify') {
    return await next();
  }

  const token = extractTokenFromRequest(c.req.raw);
  if (!token) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  try {
    if (!await jwt.verify(token, c.env.JWT_SECRET)) {
      throw new Error();
    }
    const payload = jwt.decode(token).payload as { id: string };
    const user = await getUserWithRoles(c.env.DB, payload.id);
    if (!user) {
      throw new Error();
    }
    c.set('user', user);
    c.set('userRoles', user.roles);
    await next();
  } catch {
    return c.json({ error: 'Invalid token' }, 401);
  }
}
