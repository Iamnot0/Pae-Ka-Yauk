import { sql } from '@/lib/neonHttp';
import bcrypt from 'bcryptjs';
import type { Role } from '@/lib/rbac';

// Matches Prisma's cuid() shape (25-char, leading 'c'). Mirrors the helper in
// lib/repos/materials.ts — duplicated per the project's local-generator convention.
function toCuid(): string {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
  let s = 'c';
  for (let i = 0; i < 24; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export interface StaffRow {
  id: string;
  email: string;
  name: string;
  nameLocal: string | null;
  role: Role;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface CreateStaffInput {
  email: string;
  password: string;  // plaintext, will be hashed
  name: string;
  nameLocal?: string | null;
  role: Role;
}

export interface UpdateStaffInput {
  name?: string;
  nameLocal?: string | null;
  role?: Role;
  active?: boolean;
  password?: string;  // plaintext, optional — hashed if provided
}

export async function listStaff(tenantId: string): Promise<StaffRow[]> {
  return (await sql(
    `SELECT id, email, name, "nameLocal",
            role::text AS role,
            active,
            TO_CHAR("lastLoginAt", 'YYYY-MM-DD HH24:MI') AS "lastLoginAt",
            TO_CHAR("createdAt",   'YYYY-MM-DD HH24:MI') AS "createdAt"
     FROM users
     WHERE "tenantId" = $1 AND "deletedAt" IS NULL
     ORDER BY
       CASE role
         WHEN 'OWNER' THEN 1
         WHEN 'MANAGER' THEN 2
         WHEN 'CASHIER' THEN 3
         WHEN 'BAKER' THEN 4
         ELSE 5
       END,
       name ASC`,
    [tenantId]
  )) as StaffRow[];
}

export async function createStaff(tenantId: string, input: CreateStaffInput): Promise<StaffRow> {
  const id = toCuid();
  const passwordHash = await bcrypt.hash(input.password, 10);
  // `id` and `updatedAt` are NOT NULL with no DB default — Prisma fills them
  // at the app layer, so raw SQL must do the same. `createdAt` has a DB default.
  const rows = (await sql(
    `INSERT INTO users (id, "tenantId", email, "passwordHash", name, "nameLocal", role, active, "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7::"Role", true, NOW())
     RETURNING id, email, name, "nameLocal",
               role::text AS role,
               active,
               TO_CHAR("lastLoginAt", 'YYYY-MM-DD HH24:MI') AS "lastLoginAt",
               TO_CHAR("createdAt",   'YYYY-MM-DD HH24:MI') AS "createdAt"`,
    [
      id,
      tenantId,
      input.email.trim().toLowerCase(),
      passwordHash,
      input.name.trim(),
      input.nameLocal?.trim() || null,
      input.role,
    ]
  )) as StaffRow[];
  return rows[0];
}

export async function updateStaff(
  tenantId: string,
  id: string,
  patch: UpdateStaffInput
): Promise<StaffRow | null> {
  const fields: string[] = [];
  const values: unknown[] = [tenantId, id];
  let i = 3;
  if (patch.name !== undefined) { fields.push(`name = $${i++}`);           values.push(patch.name.trim()); }
  if (patch.nameLocal !== undefined) { fields.push(`"nameLocal" = $${i++}`); values.push(patch.nameLocal?.trim() || null); }
  if (patch.role !== undefined) { fields.push(`role = $${i++}::"Role"`);    values.push(patch.role); }
  if (patch.active !== undefined) { fields.push(`active = $${i++}`);        values.push(patch.active); }
  if (patch.password) {
    const hash = await bcrypt.hash(patch.password, 10);
    fields.push(`"passwordHash" = $${i++}`);
    values.push(hash);
  }
  if (fields.length === 0) {
    const rows = (await sql(
      `SELECT id, email, name, "nameLocal", role::text AS role, active,
              TO_CHAR("lastLoginAt", 'YYYY-MM-DD HH24:MI') AS "lastLoginAt",
              TO_CHAR("createdAt",   'YYYY-MM-DD HH24:MI') AS "createdAt"
       FROM users WHERE "tenantId" = $1 AND id = $2 AND "deletedAt" IS NULL`,
      [tenantId, id]
    )) as StaffRow[];
    return rows[0] ?? null;
  }
  fields.push(`"updatedAt" = NOW()`);
  const rows = (await sql(
    `UPDATE users SET ${fields.join(', ')}
     WHERE "tenantId" = $1 AND id = $2 AND "deletedAt" IS NULL
     RETURNING id, email, name, "nameLocal",
               role::text AS role,
               active,
               TO_CHAR("lastLoginAt", 'YYYY-MM-DD HH24:MI') AS "lastLoginAt",
               TO_CHAR("createdAt",   'YYYY-MM-DD HH24:MI') AS "createdAt"`,
    values
  )) as StaffRow[];
  return rows[0] ?? null;
}

/**
 * Delete a staff member. Smart: hard-deletes the row when safe, falls back to
 * soft-delete when the user has shift history (shifts.userId is the only FK
 * to users, ON DELETE RESTRICT).
 *
 * Always guards against removing the last OWNER so the tenant isn't orphaned.
 *
 * Return values:
 *   'ok'         — row gone from DB, OR soft-deleted (hidden from list) due to
 *                  referenced history. Either way the UI no longer shows it.
 *   'lastOwner'  — refused; at least one active OWNER must remain.
 *   'notFound'   — user didn't exist or was already soft-deleted.
 */
export async function deleteStaff(tenantId: string, id: string): Promise<'ok' | 'lastOwner' | 'notFound'> {
  const [target] = (await sql(
    `SELECT role::text AS role FROM users
     WHERE "tenantId" = $1 AND id = $2 AND "deletedAt" IS NULL`,
    [tenantId, id]
  )) as Array<{ role: string }>;
  if (!target) return 'notFound';

  if (target.role === 'OWNER') {
    const [count] = (await sql(
      `SELECT COUNT(*)::int AS n FROM users
       WHERE "tenantId" = $1 AND role = 'OWNER' AND active = true AND "deletedAt" IS NULL`,
      [tenantId]
    )) as Array<{ n: number }>;
    if ((count?.n ?? 0) <= 1) return 'lastOwner';
  }

  // Hard-delete path. If the user has no shifts, Postgres removes the row.
  // If they do, the FK constraint rejects — fall through to soft-delete.
  try {
    await sql(
      `DELETE FROM users WHERE "tenantId" = $1 AND id = $2`,
      [tenantId, id]
    );
    return 'ok';
  } catch (e) {
    const msg = ((e as Error).message ?? '').toLowerCase();
    const isFkViolation = msg.includes('foreign key') || msg.includes('violates');
    if (!isFkViolation) throw e;
    // fall through
  }

  await sql(
    `UPDATE users SET "deletedAt" = NOW(), active = false, "updatedAt" = NOW()
     WHERE "tenantId" = $1 AND id = $2`,
    [tenantId, id]
  );
  return 'ok';
}

export async function getStaffById(tenantId: string, id: string): Promise<StaffRow | null> {
  const rows = (await sql(
    `SELECT id, email, name, "nameLocal",
            role::text AS role,
            active,
            TO_CHAR("lastLoginAt", 'YYYY-MM-DD HH24:MI') AS "lastLoginAt",
            TO_CHAR("createdAt",   'YYYY-MM-DD HH24:MI') AS "createdAt"
     FROM users
     WHERE "tenantId" = $1 AND id = $2 AND "deletedAt" IS NULL`,
    [tenantId, id]
  )) as StaffRow[];
  return rows[0] ?? null;
}
