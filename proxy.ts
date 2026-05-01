/**
 * Proxy (request interceptor) — protects all app routes.
 * Runs at the edge before Route Handlers and pages.
 *
 * In Next.js 16 this file replaces `middleware.ts`.
 *
 * Responsibilities:
 *   1. Auth gate — redirect unauthenticated users to /login.
 *   2. RBAC gate — redirect users hitting paths their role can't access
 *      to the role's default landing path.
 *   3. Expose current pathname to Server Components via `x-pathname` header
 *      so layouts/pages can re-check RBAC against the DB-backed role.
 *
 * The cookie's `role` claim is trusted at the edge for routing decisions only
 * (auth + redirect). The authoritative check still happens in
 * (app)/layout.tsx which re-reads role from the DB.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { verifySessionToken, COOKIE_NAME } from '@/lib/auth';
import { isPathAllowed, defaultPathFor } from '@/lib/rbac';

const PUBLIC_PATHS = new Set(['/login', '/manifest.webmanifest', '/favicon.ico', '/sw.js', '/theme-init.js']);

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  if (pathname.startsWith('/api/auth/')) return true;
  if (pathname.startsWith('/_next/')) return true;
  if (pathname.startsWith('/icons/')) return true;
  if (pathname.startsWith('/fonts/')) return true;
  // Tenant logos and other public-facing uploads live here. Per-tenant
  // privacy is enforced by URL obscurity (slug + filename); we never put
  // sensitive data under /uploads/. The login page also needs unauth'd
  // access to the tenant logo.
  if (pathname.startsWith('/uploads/')) return true;
  return false;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const session = verifySessionToken(token);

  // Already logged in + visiting /login → send to role's default page
  if (pathname === '/login' && session) {
    return NextResponse.redirect(new URL(defaultPathFor(session.role), request.url));
  }

  // Public path → always allow
  if (isPublicPath(pathname)) return NextResponse.next();

  // Protected path + no session → redirect to login with intended destination
  if (!session) {
    const url = new URL('/login', request.url);
    url.searchParams.set('from', pathname);
    return NextResponse.redirect(url);
  }

  // RBAC — role not allowed here, bounce to the role's default path
  if (!isPathAllowed(session.role, pathname)) {
    return NextResponse.redirect(new URL(defaultPathFor(session.role), request.url));
  }

  // Expose pathname to Server Components (layouts / pages)
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
