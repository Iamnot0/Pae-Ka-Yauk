/**
 * Raw Materials data access layer.
 *
 * Pure functions over the Neon HTTP driver.
 * Portability: works on any Postgres — swap the sql import to pg/postgres for
 * Hostinger/self-hosted later with zero logic changes.
 *
 * Every function is tenant-scoped — pass tenantId explicitly.
 * No ORM, no Vercel-specific APIs.
 */

import { sql } from '@/lib/neonHttp';

// ---------------------------------------------------------------------------
// Types (mirror Prisma enums — keep in sync with schema.prisma)
// ---------------------------------------------------------------------------

export type MaterialCategory =
  | 'FLOUR_LEAVENING'
  | 'FAT_OIL'
  | 'DAIRY'
  | 'SWEETENER'
  | 'FRUIT_FILLING'
  | 'CHOCOLATE_NUT'
  | 'PROTEIN_SAVORY'
  | 'SAUCE_SEASONING'
  | 'COLOR_FLAVOR'
  | 'BEVERAGE_BASE'
  | 'PACKAGING'
  | 'OTHER';

export type StorageZone = 'COLD' | 'DRY' | 'SUPPLIES';
export type TrackingMode = 'WEIGHT' | 'COUNT';
export type Unit =
  | 'G' | 'KG' | 'ML' | 'L' | 'PCS' | 'BOX' | 'CUP' | 'PACK' | 'CARTON' | 'BOTTLE' | 'CAN';

export interface RawMaterial {
  id: string;
  tenantId: string;
  code: string | null;
  name: string;
  nameLocal: string | null;
  category: MaterialCategory;
  storageZone: StorageZone;
  baseUnit: Unit;
  trackBy: TrackingMode;
  replenishOnly: boolean;
  tracksExpiry: boolean;
  enforceFifo: boolean;
  parLevel: number | null;
  lastUnitCost: number | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateMaterialInput {
  code?: string | null;
  name: string;
  nameLocal?: string | null;
  category: MaterialCategory;
  storageZone?: StorageZone;
  baseUnit: Unit;
  trackBy?: TrackingMode;
  replenishOnly?: boolean;
  tracksExpiry?: boolean;
  enforceFifo?: boolean;
  parLevel?: number | null;
  lastUnitCost?: number | null;
  notes?: string | null;
}

export type UpdateMaterialInput = Partial<CreateMaterialInput> & { active?: boolean };

export interface ListFilters {
  search?: string;
  category?: MaterialCategory | 'ALL';
  storageZone?: StorageZone | 'ALL';
  includeInactive?: boolean;
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------

function toCuid(): string {
  // Same format as Prisma's cuid() — 25-char time-sortable.
  // We use a cheap local generator so we don't depend on @paralleldrive/cuid2.
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
  let s = 'c';
  for (let i = 0; i < 24; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function listMaterials(
  tenantId: string,
  filters: ListFilters = {}
): Promise<{ rows: RawMaterial[]; total: number }> {
  const {
    search,
    category = 'ALL',
    storageZone = 'ALL',
    includeInactive = false,
    limit = 200,
    offset = 0,
  } = filters;

  const conditions: string[] = ['"tenantId" = $1', '"deletedAt" IS NULL'];
  const params: unknown[] = [tenantId];
  let i = 2;

  if (!includeInactive) {
    conditions.push('active = true');
  }
  if (category && category !== 'ALL') {
    conditions.push(`category = $${i++}`);
    params.push(category);
  }
  if (storageZone && storageZone !== 'ALL') {
    conditions.push(`"storageZone" = $${i++}`);
    params.push(storageZone);
  }
  if (search && search.trim()) {
    // Starts-with match (owner pref 2026-04-26): typing "B" shows items
    // beginning with B, not items containing B mid-word. Applied across
    // name / nameLocal / code so Burmese + barcode prefixes also work.
    conditions.push(
      `(name ILIKE $${i} OR COALESCE("nameLocal", '') ILIKE $${i} OR COALESCE(code, '') ILIKE $${i})`
    );
    params.push(`${search.trim()}%`);
    i++;
  }

  const where = conditions.join(' AND ');

  // Count (for pagination)
  const countResult = (await sql(
    `SELECT COUNT(*)::int AS total FROM raw_materials WHERE ${where}`,
    params
  )) as Array<{ total: number }>;
  const total = countResult[0]?.total ?? 0;

  // Rows
  const pageParams = [...params, limit, offset];
  const rows = (await sql(
    `SELECT id, "tenantId", code, name, "nameLocal", category, "storageZone",
            "baseUnit", "trackBy", "replenishOnly", "tracksExpiry", "enforceFifo",
            "parLevel", "lastUnitCost", notes, active,
            "createdAt", "updatedAt", "deletedAt"
     FROM raw_materials
     WHERE ${where}
     ORDER BY name ASC
     LIMIT $${i++} OFFSET $${i++}`,
    pageParams
  )) as RawMaterial[];

  return { rows, total };
}

export async function getMaterial(
  tenantId: string,
  id: string
): Promise<RawMaterial | null> {
  const rows = (await sql(
    `SELECT id, "tenantId", code, name, "nameLocal", category, "storageZone",
            "baseUnit", "trackBy", "replenishOnly", "tracksExpiry", "enforceFifo",
            "parLevel", "lastUnitCost", notes, active,
            "createdAt", "updatedAt", "deletedAt"
     FROM raw_materials
     WHERE id = $1 AND "tenantId" = $2 AND "deletedAt" IS NULL
     LIMIT 1`,
    [id, tenantId]
  )) as RawMaterial[];
  return rows[0] ?? null;
}

export async function createMaterial(
  tenantId: string,
  input: CreateMaterialInput
): Promise<RawMaterial> {
  const id = toCuid();
  const rows = (await sql(
    `INSERT INTO raw_materials (
       id, "tenantId", code, name, "nameLocal", category, "storageZone",
       "baseUnit", "trackBy", "replenishOnly", "tracksExpiry", "enforceFifo",
       "parLevel", "lastUnitCost", notes, active, "createdAt", "updatedAt"
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       $8, $9, $10, $11, $12,
       $13, $14, $15, true, NOW(), NOW()
     )
     RETURNING id, "tenantId", code, name, "nameLocal", category, "storageZone",
               "baseUnit", "trackBy", "replenishOnly", "tracksExpiry", "enforceFifo",
               "parLevel", "lastUnitCost", notes, active,
               "createdAt", "updatedAt", "deletedAt"`,
    [
      id,
      tenantId,
      input.code ?? null,
      input.name,
      input.nameLocal ?? null,
      input.category,
      input.storageZone ?? 'DRY',
      input.baseUnit,
      input.trackBy ?? 'WEIGHT',
      input.replenishOnly ?? false,
      input.tracksExpiry ?? false,
      input.enforceFifo ?? false,
      input.parLevel ?? null,
      input.lastUnitCost ?? null,
      input.notes ?? null,
    ]
  )) as RawMaterial[];
  return rows[0];
}

export async function updateMaterial(
  tenantId: string,
  id: string,
  input: UpdateMaterialInput
): Promise<RawMaterial | null> {
  // Build dynamic SET clause from defined fields only
  const fields: Array<{ col: string; value: unknown }> = [];
  if (input.code !== undefined)          fields.push({ col: 'code',          value: input.code });
  if (input.name !== undefined)          fields.push({ col: 'name',          value: input.name });
  if (input.nameLocal !== undefined)     fields.push({ col: 'nameLocal',     value: input.nameLocal });
  if (input.category !== undefined)      fields.push({ col: 'category',      value: input.category });
  if (input.storageZone !== undefined)   fields.push({ col: 'storageZone',   value: input.storageZone });
  if (input.baseUnit !== undefined)      fields.push({ col: 'baseUnit',      value: input.baseUnit });
  if (input.trackBy !== undefined)       fields.push({ col: 'trackBy',       value: input.trackBy });
  if (input.replenishOnly !== undefined) fields.push({ col: 'replenishOnly', value: input.replenishOnly });
  if (input.tracksExpiry !== undefined)  fields.push({ col: 'tracksExpiry',  value: input.tracksExpiry });
  if (input.enforceFifo !== undefined)   fields.push({ col: 'enforceFifo',   value: input.enforceFifo });
  if (input.parLevel !== undefined)      fields.push({ col: 'parLevel',      value: input.parLevel });
  if (input.lastUnitCost !== undefined)  fields.push({ col: 'lastUnitCost',  value: input.lastUnitCost });
  if (input.notes !== undefined)         fields.push({ col: 'notes',         value: input.notes });
  if (input.active !== undefined)        fields.push({ col: 'active',        value: input.active });

  if (!fields.length) return getMaterial(tenantId, id);

  const setFragments = fields.map((f, idx) => `"${f.col}" = $${idx + 1}`);
  setFragments.push(`"updatedAt" = NOW()`);
  const values = fields.map(f => f.value);
  const idParam = values.length + 1;
  const tenantParam = values.length + 2;

  const rows = (await sql(
    `UPDATE raw_materials
     SET ${setFragments.join(', ')}
     WHERE id = $${idParam} AND "tenantId" = $${tenantParam} AND "deletedAt" IS NULL
     RETURNING id, "tenantId", code, name, "nameLocal", category, "storageZone",
               "baseUnit", "trackBy", "replenishOnly", "tracksExpiry", "enforceFifo",
               "parLevel", "lastUnitCost", notes, active,
               "createdAt", "updatedAt", "deletedAt"`,
    [...values, id, tenantId]
  )) as RawMaterial[];
  return rows[0] ?? null;
}

export interface BulkResult {
  created: RawMaterial[];
  skipped: Array<{ name: string; reason: string }>;
}

/**
 * Bulk-insert materials. Performs an existence check in one query, then
 * inserts new rows one by one (for FK/trigger safety). Skips duplicates
 * (same tenant + case-insensitive name match) with reason "Already exists".
 *
 * Portable: pure SQL, no Prisma, no ORM.
 */
export async function bulkCreateMaterials(
  tenantId: string,
  inputs: CreateMaterialInput[]
): Promise<BulkResult> {
  if (inputs.length === 0) return { created: [], skipped: [] };

  // One query to find all existing names (case-insensitive)
  const names = inputs.map((x) => x.name.trim());
  const lowered = names.map((n) => n.toLowerCase());

  const existing = (await sql(
    `SELECT LOWER(name) AS lower_name
     FROM raw_materials
     WHERE "tenantId" = $1
       AND "deletedAt" IS NULL
       AND LOWER(name) = ANY($2::text[])`,
    [tenantId, lowered]
  )) as Array<{ lower_name: string }>;

  const existingSet = new Set(existing.map((x) => x.lower_name));

  const created: RawMaterial[] = [];
  const skipped: BulkResult['skipped'] = [];

  for (const input of inputs) {
    const cleanName = input.name.trim();
    if (!cleanName) {
      skipped.push({ name: '(blank)', reason: 'Name is empty' });
      continue;
    }
    if (existingSet.has(cleanName.toLowerCase())) {
      skipped.push({ name: cleanName, reason: 'Already exists' });
      continue;
    }
    // Deduplicate within the batch itself
    existingSet.add(cleanName.toLowerCase());

    try {
      const material = await createMaterial(tenantId, { ...input, name: cleanName });
      created.push(material);
    } catch (e) {
      const msg = (e as Error).message || 'Database error';
      skipped.push({ name: cleanName, reason: msg.slice(0, 160) });
    }
  }

  return { created, skipped };
}

export async function softDeleteMaterial(
  tenantId: string,
  id: string
): Promise<boolean> {
  const rows = (await sql(
    `UPDATE raw_materials
     SET "deletedAt" = NOW(), active = false, "updatedAt" = NOW()
     WHERE id = $1 AND "tenantId" = $2 AND "deletedAt" IS NULL
     RETURNING id`,
    [id, tenantId]
  )) as Array<{ id: string }>;
  return rows.length > 0;
}
