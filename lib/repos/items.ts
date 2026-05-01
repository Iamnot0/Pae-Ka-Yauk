/**
 * Sellable Items (menu) data access layer.
 *
 * Pure functions over the Neon HTTP driver. Portable — swap the sql import
 * to pg/postgres for Hostinger VPS with zero logic changes.
 *
 * Every function tenant-scoped via explicit tenantId argument.
 */

import { sql } from '@/lib/neonHttp';
import type { InventoryMode } from '@/lib/featureMode';

// ---------------------------------------------------------------------------
// Types (mirror Prisma ItemCategory enum)
// ---------------------------------------------------------------------------

export type ItemCategory =
  | 'BAKERY_BREAD'
  | 'BAKERY_CAKE'
  | 'BAKERY_COOKIES'
  | 'BAKERY_PASTRY'
  | 'BAKERY_SAVORY'
  | 'COFFEE_HOT'
  | 'COFFEE_COLD'
  | 'TEA'
  | 'COLD_DRINK'
  | 'DESSERT'
  | 'OTHER';

export type ProductionMode = 'DIRECT' | 'BATCH';

export interface SellableItem {
  id: string;
  tenantId: string;
  sku: string | null;
  name: string;
  nameLocal: string | null;
  category: ItemCategory;
  price: number;
  taxRate: number;
  imageUrl: string | null;
  description: string | null;
  productionMode: ProductionMode;
  finishedGoodsOnHand: number;
  active: boolean;
  sortOrder: number;
  manualCost: number | null;
  shelfLifeDays: number | null;
  /** Per-item expiry date (calendar day, ISO yyyy-mm-dd). null = not tracked. */
  expiryDate: string | null;
  unit: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateItemInput {
  sku?: string | null;
  name: string;
  nameLocal?: string | null;
  category: ItemCategory;
  price: number;
  taxRate?: number;
  imageUrl?: string | null;
  description?: string | null;
  productionMode?: ProductionMode;
  active?: boolean;
  sortOrder?: number;
  piecesPerPack?: number | null;
  shelfLifeDays?: number | null;
  /** ISO yyyy-mm-dd. */
  expiryDate?: string | null;
  manualCost?: number | null;
  unit?: string | null;
  /** Initial on-hand quantity (used by xlsx import to seed opening stock). */
  finishedGoodsOnHand?: number;
}

export type UpdateItemInput = Partial<CreateItemInput>;

export interface ListFilters {
  search?: string;
  category?: ItemCategory | 'ALL';
  includeInactive?: boolean;
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// Util
// ---------------------------------------------------------------------------

function toCuid(): string {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
  let s = 'c';
  for (let i = 0; i < 24; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function listItems(
  tenantId: string,
  filters: ListFilters = {}
): Promise<{ rows: SellableItem[]; total: number }> {
  const {
    search, category = 'ALL', includeInactive = false, limit = 500, offset = 0,
  } = filters;

  const conditions: string[] = ['"tenantId" = $1', '"deletedAt" IS NULL'];
  const params: unknown[] = [tenantId];
  let i = 2;

  if (!includeInactive) conditions.push('active = true');
  if (category && category !== 'ALL') {
    conditions.push(`category = $${i++}`);
    params.push(category);
  }
  if (search && search.trim()) {
    // Starts-with on name/nameLocal (typing "Soft" → Soft Roll, not Microsoft);
    // substring on SKU because barcodes are scanned in full and a partial paste
    // is more useful as substring.
    const trimmed = search.trim();
    conditions.push(
      `(name ILIKE $${i} OR COALESCE("nameLocal",'') ILIKE $${i} OR COALESCE(sku,'') ILIKE $${i + 1})`
    );
    params.push(`${trimmed}%`);
    params.push(`%${trimmed}%`);
    i += 2;
  }

  const where = conditions.join(' AND ');

  const countRes = (await sql(
    `SELECT COUNT(*)::int AS total FROM sellable_items WHERE ${where}`,
    params
  )) as Array<{ total: number }>;
  const total = countRes[0]?.total ?? 0;

  const rows = (await sql(
    `SELECT id, "tenantId", sku, name, "nameLocal", category,
            price::float8 AS price, "taxRate"::float8 AS "taxRate",
            "imageUrl", description,
            "productionMode",
            "finishedGoodsOnHand"::float8 AS "finishedGoodsOnHand",
            active, "sortOrder",
            "manualCost"::float8 AS "manualCost",
            "shelfLifeDays", "expiryDate"::text AS "expiryDate", unit,
            "createdAt", "updatedAt", "deletedAt"
     FROM sellable_items
     WHERE ${where}
     ORDER BY "sortOrder" ASC, name ASC
     LIMIT $${i++} OFFSET $${i++}`,
    [...params, limit, offset]
  )) as SellableItem[];

  return { rows, total };
}

export async function getItem(tenantId: string, id: string): Promise<SellableItem | null> {
  const rows = (await sql(
    `SELECT id, "tenantId", sku, name, "nameLocal", category,
            price::float8 AS price, "taxRate"::float8 AS "taxRate",
            "imageUrl", description,
            "productionMode",
            "finishedGoodsOnHand"::float8 AS "finishedGoodsOnHand",
            active, "sortOrder",
            "manualCost"::float8 AS "manualCost",
            "shelfLifeDays", "expiryDate"::text AS "expiryDate", unit,
            "createdAt", "updatedAt", "deletedAt"
     FROM sellable_items
     WHERE id = $1 AND "tenantId" = $2 AND "deletedAt" IS NULL
     LIMIT 1`,
    [id, tenantId]
  )) as SellableItem[];
  return rows[0] ?? null;
}

export async function createItem(tenantId: string, input: CreateItemInput): Promise<SellableItem> {
  const id = toCuid();
  // SKU allocation: caller-supplied wins (manual barcode override). Otherwise
  // we pick the next sequential 8-digit numeric for this tenant, computed
  // inside the INSERT so two concurrent creates can't pick the same number.
  const callerSku = input.sku?.trim() || null;

  const rows = (await sql(
    `INSERT INTO sellable_items (
       id, "tenantId", sku, name, "nameLocal", category,
       price, "taxRate", "imageUrl", description,
       "productionMode",
       active, "sortOrder", "piecesPerPack", "shelfLifeDays",
       "expiryDate",
       "manualCost", unit, "finishedGoodsOnHand",
       "createdAt", "updatedAt"
     )
     SELECT $1, $2,
            COALESCE($3, LPAD((
              (SELECT COALESCE(MAX(CASE WHEN sku ~ '^[0-9]{8}$' THEN sku::bigint END), 10000000)
                 FROM sellable_items WHERE "tenantId" = $2)
              + 1
            )::text, 8, '0')),
            $4, $5, $6,
            $7, $8, $9, $10,
            $11,
            $12, $13, $14, $15,
            $16,
            $17, $18, $19,
            NOW(), NOW()
     RETURNING id, "tenantId", sku, name, "nameLocal", category,
               price::float8 AS price, "taxRate"::float8 AS "taxRate",
               "imageUrl", description, "productionMode",
               "finishedGoodsOnHand"::float8 AS "finishedGoodsOnHand",
               active, "sortOrder",
               "manualCost"::float8 AS "manualCost",
               "shelfLifeDays", unit,
               "createdAt", "updatedAt", "deletedAt"`,
    [
      id,
      tenantId,
      callerSku,
      input.name,
      input.nameLocal ?? null,
      input.category,
      input.price,
      input.taxRate ?? 0,
      input.imageUrl ?? null,
      input.description ?? null,
      input.productionMode ?? 'DIRECT',
      input.active ?? true,
      input.sortOrder ?? 0,
      input.piecesPerPack ?? null,
      input.shelfLifeDays ?? null,
      input.expiryDate ?? null,
      input.manualCost ?? null,
      input.unit ?? null,
      input.finishedGoodsOnHand ?? 0,
    ]
  )) as SellableItem[];
  return rows[0];
}

export async function updateItem(
  tenantId: string,
  id: string,
  input: UpdateItemInput
): Promise<SellableItem | null> {
  const fields: Array<{ col: string; value: unknown }> = [];
  if (input.sku !== undefined)         fields.push({ col: 'sku',         value: input.sku });
  if (input.name !== undefined)        fields.push({ col: 'name',        value: input.name });
  if (input.nameLocal !== undefined)   fields.push({ col: 'nameLocal',   value: input.nameLocal });
  if (input.category !== undefined)    fields.push({ col: 'category',    value: input.category });
  if (input.price !== undefined)       fields.push({ col: 'price',       value: input.price });
  if (input.taxRate !== undefined)     fields.push({ col: 'taxRate',     value: input.taxRate });
  if (input.imageUrl !== undefined)    fields.push({ col: 'imageUrl',    value: input.imageUrl });
  if (input.description !== undefined) fields.push({ col: 'description', value: input.description });
  if (input.productionMode !== undefined) fields.push({ col: 'productionMode', value: input.productionMode });
  if (input.active !== undefined)      fields.push({ col: 'active',      value: input.active });
  if (input.sortOrder !== undefined)   fields.push({ col: 'sortOrder',   value: input.sortOrder });
  if (input.piecesPerPack !== undefined) fields.push({ col: 'piecesPerPack', value: input.piecesPerPack });
  if (input.shelfLifeDays !== undefined) fields.push({ col: 'shelfLifeDays', value: input.shelfLifeDays });
  if (input.expiryDate !== undefined)    fields.push({ col: 'expiryDate',    value: input.expiryDate });
  if (input.manualCost !== undefined)  fields.push({ col: 'manualCost',   value: input.manualCost });
  if (input.unit !== undefined)        fields.push({ col: 'unit',         value: input.unit });

  if (!fields.length) return getItem(tenantId, id);

  const setFragments = fields.map((f, idx) => `"${f.col}" = $${idx + 1}`);
  setFragments.push(`"updatedAt" = NOW()`);
  const values = fields.map((f) => f.value);
  const idParam = values.length + 1;
  const tenantParam = values.length + 2;

  const rows = (await sql(
    `UPDATE sellable_items
     SET ${setFragments.join(', ')}
     WHERE id = $${idParam} AND "tenantId" = $${tenantParam} AND "deletedAt" IS NULL
     RETURNING id, "tenantId", sku, name, "nameLocal", category,
               price::float8 AS price, "taxRate"::float8 AS "taxRate",
               "imageUrl", description, "productionMode",
               "finishedGoodsOnHand"::float8 AS "finishedGoodsOnHand",
               active, "sortOrder",
               "manualCost"::float8 AS "manualCost",
               "shelfLifeDays", unit,
               "createdAt", "updatedAt", "deletedAt"`,
    [...values, id, tenantId]
  )) as SellableItem[];
  return rows[0] ?? null;
}

export async function softDeleteItem(tenantId: string, id: string): Promise<boolean> {
  const rows = (await sql(
    `UPDATE sellable_items
     SET "deletedAt" = NOW(), active = false, "updatedAt" = NOW()
     WHERE id = $1 AND "tenantId" = $2 AND "deletedAt" IS NULL
     RETURNING id`,
    [id, tenantId]
  )) as Array<{ id: string }>;
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

// Re-export the pure helper so existing callers of items repo keep working.
// Pure version lives in lib/items/cost.ts so client components can import
// it without pulling in the Neon HTTP driver.
export { resolveDisplayCost } from '@/lib/items/cost';
