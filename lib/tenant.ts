/**
 * Tenant resolution via Neon HTTP driver (hot-path reliability).
 */

import { cache } from 'react';
import { sql } from '@/lib/neonHttp';
import { readSession } from '@/lib/auth';

export interface CurrentTenant {
  id: string;
  slug: string;
  name: string;
  nameLocal: string | null;
  currency: string;
  locale: string;
  timezone: string;
}

export const getCurrentTenant = cache(async (): Promise<CurrentTenant> => {
  const session = await readSession();

  if (session) {
    const rows = (await sql`
      SELECT id, slug, name, "nameLocal", currency, locale, timezone
      FROM tenants
      WHERE id = ${session.tenantId}
      LIMIT 1
    `) as CurrentTenant[];
    if (rows[0]) return rows[0];
  }

  // Fallback: env var (setup scripts, unauthenticated pages)
  const slug = process.env.TENANT_SLUG ?? 'pae-ka-yauk';
  const rows = (await sql`
    SELECT id, slug, name, "nameLocal", currency, locale, timezone
    FROM tenants
    WHERE slug = ${slug}
    LIMIT 1
  `) as CurrentTenant[];

  if (!rows[0]) {
    throw new Error(
      `Tenant "${slug}" not found. Did you run \`node --env-file=.env scripts/seed.mjs\` ?`
    );
  }
  return rows[0];
});

export async function requireTenant() {
  return getCurrentTenant();
}
