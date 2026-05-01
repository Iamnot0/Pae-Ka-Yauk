/**
 * Modifiers data access layer (Size, Milk, Add-on, etc.).
 *
 * Used by POS tickets to add price deltas on top of base item prices.
 * Phase 1 ships CRUD; attach-to-item wiring arrives in Sprint 3 alongside recipes.
 */

import { sql } from '@/lib/neonHttp';

export interface Modifier {
  id: string;
  tenantId: string;
  group: string;           // "Size", "Milk", "Add-on"
  name: string;            // "Large", "Oat", "Extra Shot"
  nameLocal: string | null;
  priceDelta: number;      // MMK delta: +500, +1000, -200
  active: boolean;
}

export interface CreateModifierInput {
  group: string;
  name: string;
  nameLocal?: string | null;
  priceDelta: number;
  active?: boolean;
}

export type UpdateModifierInput = Partial<CreateModifierInput>;

function toCuid(): string {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
  let s = 'c';
  for (let i = 0; i < 24; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export async function listModifiers(tenantId: string): Promise<Modifier[]> {
  return (await sql(
    `SELECT id, "tenantId", "group", name, "nameLocal",
            "priceDelta"::float8 AS "priceDelta", active
     FROM modifiers
     WHERE "tenantId" = $1
     ORDER BY "group" ASC, name ASC`,
    [tenantId]
  )) as Modifier[];
}

export async function getModifier(tenantId: string, id: string): Promise<Modifier | null> {
  const rows = (await sql(
    `SELECT id, "tenantId", "group", name, "nameLocal",
            "priceDelta"::float8 AS "priceDelta", active
     FROM modifiers WHERE id = $1 AND "tenantId" = $2 LIMIT 1`,
    [id, tenantId]
  )) as Modifier[];
  return rows[0] ?? null;
}

export async function createModifier(tenantId: string, input: CreateModifierInput): Promise<Modifier> {
  const rows = (await sql(
    `INSERT INTO modifiers (id, "tenantId", "group", name, "nameLocal", "priceDelta", active)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, "tenantId", "group", name, "nameLocal",
               "priceDelta"::float8 AS "priceDelta", active`,
    [
      toCuid(),
      tenantId,
      input.group.trim(),
      input.name.trim(),
      input.nameLocal ?? null,
      input.priceDelta,
      input.active ?? true,
    ]
  )) as Modifier[];
  return rows[0];
}

export async function updateModifier(
  tenantId: string,
  id: string,
  input: UpdateModifierInput
): Promise<Modifier | null> {
  const fields: Array<{ col: string; value: unknown }> = [];
  if (input.group !== undefined)      fields.push({ col: 'group',      value: input.group.trim() });
  if (input.name !== undefined)       fields.push({ col: 'name',       value: input.name.trim() });
  if (input.nameLocal !== undefined)  fields.push({ col: 'nameLocal',  value: input.nameLocal });
  if (input.priceDelta !== undefined) fields.push({ col: 'priceDelta', value: input.priceDelta });
  if (input.active !== undefined)     fields.push({ col: 'active',     value: input.active });

  if (!fields.length) return getModifier(tenantId, id);

  const setFragments = fields.map((f, idx) => `"${f.col}" = $${idx + 1}`);
  const values = fields.map((f) => f.value);
  const idParam = values.length + 1;
  const tenantParam = values.length + 2;

  const rows = (await sql(
    `UPDATE modifiers SET ${setFragments.join(', ')}
     WHERE id = $${idParam} AND "tenantId" = $${tenantParam}
     RETURNING id, "tenantId", "group", name, "nameLocal",
               "priceDelta"::float8 AS "priceDelta", active`,
    [...values, id, tenantId]
  )) as Modifier[];
  return rows[0] ?? null;
}

export async function deleteModifier(tenantId: string, id: string): Promise<boolean> {
  const rows = (await sql(
    `DELETE FROM modifiers WHERE id = $1 AND "tenantId" = $2 RETURNING id`,
    [id, tenantId]
  )) as Array<{ id: string }>;
  return rows.length > 0;
}
