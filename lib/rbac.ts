/**
 * Role-based access control.
 *
 * The authoritative source for:
 *   - which sidebar nav items each role sees
 *   - which URL prefixes each role is allowed to visit
 *   - where each role lands after login
 *
 * Enforced at three layers:
 *   - proxy.ts         — edge gate (redirects before the route runs)
 *   - (app)/layout.tsx — re-check with DB-backed role (proxy only sees cookie)
 *   - Sidebar.tsx      — filter NAV so the UI only shows accessible links
 */

export type Role = 'OWNER' | 'MANAGER' | 'CASHIER' | 'BAKER';

/**
 * Path prefixes a role is allowed to access. Use `null` for full access.
 * Non-null entries are prefix-matched: if `/inventory/new` starts with
 * `/inventory`, it's allowed.
 *
 * Note: `/` (dashboard) is its own entry — prefix match would make every
 * path start with `/`, so it's checked as an exact path.
 */
export const ROLE_ALLOWED_PATHS: Record<Role, string[] | null> = {
  OWNER:   null,
  MANAGER: null,
  CASHIER: ['/pos', '/inventory', '/reports', '/stocks'],
  BAKER:   ['/production', '/recipes'],
};

/**
 * Where each role lands when they hit a path they can't access (including `/`).
 * Must be in the role's allowed list.
 */
export const ROLE_DEFAULT_PATH: Record<Role, string> = {
  OWNER:   '/',
  MANAGER: '/',
  CASHIER: '/pos',
  BAKER:   '/production',
};

/**
 * Roles that can view the staff list and create/edit/suspend staff.
 * Delete is separately restricted — see STAFF_DELETE_ROLES.
 */
export const STAFF_ADMIN_ROLES: Role[] = ['OWNER', 'MANAGER'];

/**
 * Destructive action — permanently remove a staff account from the system.
 * Only OWNER. Managers can suspend (reversible) but not delete.
 */
export const STAFF_DELETE_ROLES: Role[] = ['OWNER'];

export function isRole(value: string): value is Role {
  return value === 'OWNER' || value === 'MANAGER' || value === 'CASHIER' || value === 'BAKER';
}

export function defaultPathFor(role: string): string {
  return isRole(role) ? ROLE_DEFAULT_PATH[role] : '/';
}

/**
 * Returns true if the given role can visit the given pathname.
 * API routes (/api/*) are ALWAYS allowed at the proxy layer — route handlers
 * do their own role checks via requireRole() so we don't double-gate them here.
 */
export function isPathAllowed(role: string, pathname: string): boolean {
  if (pathname.startsWith('/api/')) return true;
  if (!isRole(role)) return false;

  const allowed = ROLE_ALLOWED_PATHS[role];
  if (allowed === null) return true;

  // Root path `/` is its own match — don't prefix-match or everything passes.
  if (pathname === '/') return false;

  return allowed.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * Nav items each role can see, in display order.
 * Keys match Sidebar's NAV[].href values.
 */
export function navHrefsForRole(role: string): string[] {
  if (!isRole(role)) return [];
  const baseNav = ['/', '/staffs', '/pos', '/stocks', '/inventory', '/recipes', '/production', '/reports'];
  const allowed = ROLE_ALLOWED_PATHS[role];
  if (allowed === null) return baseNav;
  return baseNav.filter((href) => isPathAllowed(role, href));
}
