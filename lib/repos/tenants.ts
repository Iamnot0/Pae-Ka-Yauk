/**
 * Tenant brand repo — fetches the per-tenant info that drives the
 * <Header /> visuals (name, nameLocal, logoUrl).
 *
 * Used in app/(app)/layout.tsx via React's `cache()` so multi-call render
 * trees only hit Neon once per request.
 */

import { cache } from 'react';
import { sql } from '@/lib/neonHttp';

export interface TenantBrand {
  id: string;
  name: string;
  nameLocal: string | null;
  logoUrl: string | null;
}

export const getTenantBrand = cache(async (tenantId: string): Promise<TenantBrand | null> => {
  const rows = (await sql(
    `SELECT id, name, "nameLocal", "logoUrl"
     FROM tenants
     WHERE id = $1
     LIMIT 1`,
    [tenantId],
  )) as TenantBrand[];
  return rows[0] ?? null;
});

/**
 * Lookup tenant slug by id — used by Phase 2's OfflineBoot to key the
 * IndexedDB catalog cache. cache()-wrapped to share the call with
 * getTenantBrand on the same render.
 */
export const getTenantSlugById = cache(async (tenantId: string): Promise<string> => {
  const rows = (await sql(
    `SELECT slug FROM tenants WHERE id = $1 LIMIT 1`,
    [tenantId],
  )) as Array<{ slug: string }>;
  return rows[0]?.slug ?? 'unknown';
});
