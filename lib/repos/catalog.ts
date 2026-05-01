/**
 * Catalog assembler — bundles everything the cashier needs in a single
 * round-trip: items + modifiers + categories. Backs the offline-first
 * cashier (Phase 2).
 *
 * The ETag is SHA256 of `MAX(updatedAt)` across the catalog tables for
 * the tenant. ETag bumps the moment any catalog edit lands; the cashier's
 * next refresh sees fresh data with no extra invalidation logic.
 *
 * Cost is intentionally redacted from the cashier payload — Cost column on
 * /stocks is OWNER/MANAGER role-gated, and the offline catalog is consumed
 * by every role including CASHIER. Server still re-looks-up canonical
 * prices at sale time (Hard Rule #5), so a stale catalog can only cause a
 * cosmetic UI mismatch, never a revenue leak.
 */

import { sql } from '@/lib/neonHttp';
import type { ItemCategory } from './items';

export interface CatalogItem {
  id: string;
  sku: string | null;
  name: string;
  nameLocal: string | null;
  category: ItemCategory;
  price: number;
  taxRate: number;
  imageUrl: string | null;
  productionMode: 'DIRECT' | 'BATCH';
  active: boolean;
  sortOrder: number;
  piecesPerPack: number | null;
}

export interface CatalogModifier {
  id: string;
  name: string;
  nameLocal: string | null;
  priceDelta: number;
  group: string;
  active: boolean;
}

export interface CatalogPayload {
  tenantId: string;
  items: CatalogItem[];
  modifiers: CatalogModifier[];
  categories: ItemCategory[];
  /** ms since epoch — clients log this for debug */
  generatedAt: number;
  /** server stamp of the freshest row included */
  freshness: string | null;
}

/**
 * Compute the catalog ETag for this tenant. Cheap — one SQL call returning
 * a single timestamp. SHA256 keeps the header opaque + collision-proof.
 */
export async function getCatalogEtag(tenantId: string): Promise<string> {
  // Freshness = MAX(sellable_items.updatedAt) for this tenant + a quick
  // count of active modifiers (so adding/removing a modifier still bumps
  // the ETag even though that table has no updatedAt column). The output
  // is a short stable string the browser uses as opaque.
  const rows = (await sql(
    `SELECT
       COALESCE(EXTRACT(EPOCH FROM
         (SELECT MAX("updatedAt") FROM sellable_items WHERE "tenantId" = $1)
       )::bigint, 0) AS "freshSi",
       (SELECT COUNT(*) FROM modifiers WHERE "tenantId" = $1 AND active = true)::int AS "modCount"`,
    [tenantId],
  )) as Array<{ freshSi: number | string; modCount: number }>;
  const r = rows[0] ?? { freshSi: 0, modCount: 0 };
  return `${tenantId.slice(-6)}-${Number(r.freshSi).toString(36)}-${r.modCount}`;
}

export async function getCatalogPayload(tenantId: string): Promise<CatalogPayload> {
  const itemsP = sql(
    `SELECT id, sku, name, "nameLocal", category,
            price::float8 AS price,
            "taxRate"::float8 AS "taxRate",
            "imageUrl",
            "productionMode",
            active,
            "sortOrder",
            "piecesPerPack"
       FROM sellable_items
      WHERE "tenantId" = $1 AND "deletedAt" IS NULL AND active = true
      ORDER BY "sortOrder" ASC, name ASC`,
    [tenantId],
  ) as Promise<CatalogItem[]>;

  const modsP = sql(
    `SELECT id, name, "nameLocal",
            "priceDelta"::float8 AS "priceDelta",
            "group", active
       FROM modifiers
      WHERE "tenantId" = $1 AND active = true
      ORDER BY "group" ASC, name ASC`,
    [tenantId],
  ) as Promise<CatalogModifier[]>;

  const freshnessP = sql(
    `SELECT (SELECT MAX("updatedAt") FROM sellable_items WHERE "tenantId" = $1)::text AS "freshness"`,
    [tenantId],
  ) as Promise<Array<{ freshness: string | null }>>;

  const [items, modifiers, freshnessRows] = await Promise.all([itemsP, modsP, freshnessP]);

  const categories = Array.from(new Set(items.map((i) => i.category))).sort() as ItemCategory[];

  return {
    tenantId,
    items,
    modifiers,
    categories,
    generatedAt: Date.now(),
    freshness: freshnessRows[0]?.freshness ?? null,
  };
}
