/**
 * Feature mode helper — single source of truth for PAUSED ↔ FULL branching.
 *
 * Phase 1 ships with `inventoryMode = POS_PAUSED` for the Pae Ka Yauk tenant
 * (POS-only, no raw-material deduction). Switching the tenant row to `FULL`
 * enables BOM deduction at sale/bake time without any code change.
 *
 * Wrapped in React `cache()` so multiple callers in the same render tree
 * (layout + page + helpers) only hit Neon once per request — same pattern
 * as `getCurrentUser` in lib/auth.ts.
 */

import { cache } from 'react';
import { sql } from '@/lib/neonHttp';

export type InventoryMode = 'POS_PAUSED' | 'FULL';

export const getInventoryMode = cache(
  async (tenantId: string): Promise<InventoryMode> => {
    const rows = (await sql(
      `SELECT "inventoryMode" FROM tenants WHERE id = $1`,
      [tenantId],
    )) as Array<{ inventoryMode: InventoryMode }>;
    return rows[0]?.inventoryMode ?? 'POS_PAUSED';
  },
);

export const shouldDeductRawMaterials = (mode: InventoryMode): boolean =>
  mode === 'FULL';

export const catalogCacheKey = (mode: InventoryMode, version = 'v1'): string =>
  `pky.catalog.${version}.${mode}`;
