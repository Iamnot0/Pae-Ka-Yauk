/**
 * Minimal auth — signed cookie session.
 * No JWT library, no external auth service. HMAC-SHA256 over JSON payload.
 *
 * Cookie format: base64url(payload).base64url(signature)
 *
 * NOTE: hot-path DB lookups use the Neon HTTP driver (lib/neonHttp) — see
 * app/api/auth/login/route.ts for the rationale (WebSocket is flaky on dev).
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import crypto from 'node:crypto';
import { sql } from '@/lib/neonHttp';

const COOKIE_NAME = 'paeKaYauk.session';
const MAX_AGE_SECONDS = 60 * 60 * 12; // 12 hours

export interface SessionPayload {
  userId: string;
  tenantId: string;
  role: string;
  iat: number;
  exp: number;
}

function getSecret(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error('NEXTAUTH_SECRET not set');
  return s;
}

function b64url(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf) : buf;
  return b.toString('base64url');
}

function sign(payload: SessionPayload): string {
  const data = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', getSecret()).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verify(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const [data, sig] = token.split('.');
  if (!data || !sig) return null;

  const expected = crypto
    .createHmac('sha256', getSecret())
    .update(data)
    .digest('base64url');

  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString()) as SessionPayload;
    if (payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function signSession(input: { userId: string; tenantId: string; role: string }) {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    userId: input.userId,
    tenantId: input.tenantId,
    role: input.role,
    iat: now,
    exp: now + MAX_AGE_SECONDS,
  };
  const token = sign(payload);
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearSession() {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

export async function readSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  return verify(jar.get(COOKIE_NAME)?.value);
}

export interface CurrentUser {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  nameLocal: string | null;
  role: string;
  active: boolean;
}

/**
 * Full user object from DB. Use in server components.
 *
 * Wrapped in `cache()` so a single request hitting multiple
 * `requireUser()` / `requireRole()` calls (layout + page + helpers)
 * only touches the DB once.
 *
 * DB errors are intentionally NOT caught here. The retry-exhausted failure
 * case should surface at the error boundary (`app/(app)/error.tsx`) so the
 * user sees a proper retry UI instead of being silently logged out on a
 * transient Neon cold-start.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await readSession();
  if (!session) return null;
  const rows = (await sql`
    SELECT id, "tenantId", email, name, "nameLocal", role, active
    FROM users
    WHERE id = ${session.userId} AND active = true
    LIMIT 1
  `) as CurrentUser[];
  return rows[0] ?? null;
});

/** Guard a server component/route. Redirects to /login if unauthenticated. */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

/** Same as above but also verifies role. Redirects to role-default on deny. */
export async function requireRole(...allowed: string[]) {
  const user = await requireUser();
  if (!allowed.includes(user.role)) {
    const { defaultPathFor } = await import('@/lib/rbac');
    redirect(defaultPathFor(user.role) as unknown as never);
  }
  return user;
}

// Middleware helper (edge-safe — no DB)
export { verify as verifySessionToken, COOKIE_NAME };
