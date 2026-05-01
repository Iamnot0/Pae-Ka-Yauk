/**
 * Raw-material waste endpoint.
 *
 *   POST /api/inventory/waste
 *     { id, materialId, qty, unit, reason, note? }
 *
 * Side effects:
 *   - INSERT waste_entries (audit anchor with reason code)
 *   - FIFO-deduct stock_batches via lib/stock/ledger.ts → recordWasteDeduction
 *     (stock_movements stamped reason='WASTE', wasteId=<row>)
 *
 * Idempotency:
 *   POSTing the same body twice (same `id`) yields ONE waste_entries row
 *   and ONE stock deduction. ON CONFLICT (id) DO NOTHING handles the audit
 *   row; the deduction is gated on `wasInserted`.
 *
 *   Contract: client MUST resend an identical body on retry. If the same
 *   `id` arrives with a different body, the server returns the canonical
 *   persisted state from the FIRST POST.
 *
 * RBAC: any logged-in role can log waste — bakers see it most directly
 * (spoiled / overproduction), but cashiers also handle breakage at POS.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/neonHttp';
import { recordWasteDeduction } from '@/lib/stock/ledger';
import { ULID_REGEX } from '@/lib/client/ulid';

const UNITS = ['G', 'KG', 'ML', 'L', 'PCS', 'BOX', 'PACK', 'CUP', 'BOTTLE'] as const;

const REASONS = [
  'SPOILED', 'OVERPRODUCTION', 'STAFF_MEAL', 'TESTING',
  'CUSTOMER_RETURN', 'BREAKAGE', 'THEFT', 'OTHER',
] as const;

const Schema = z.object({
  id: z.string().regex(ULID_REGEX),
  materialId: z.string().min(1),
  qty: z.number().positive(),
  unit: z.enum(UNITS),
  reason: z.enum(REASONS),
  note: z.string().trim().max(500).nullable().optional(),
});

export async function POST(req: Request) {
  const user = await requireUser();

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { id, materialId, qty, unit, reason, note } = parsed.data;

  // 1. Verify material belongs to tenant + grab its name (for friendly errors
  //    out of the ledger if the deduction fails for short stock).
  const matRows = (await sql(
    `SELECT id, name, "baseUnit", "lastUnitCost"::float8 AS "lastUnitCost"
       FROM raw_materials
      WHERE id = $1 AND "tenantId" = $2 AND "deletedAt" IS NULL`,
    [materialId, user.tenantId],
  )) as Array<{ id: string; name: string; baseUnit: string; lastUnitCost: number | null }>;
  if (matRows.length === 0) {
    return NextResponse.json({ error: 'Material not found' }, { status: 404 });
  }
  const mat = matRows[0];

  // 2. Insert waste_entries row idempotently. Snapshot unitCost + totalCost
  //    at the time of waste so historical reports stay accurate even after
  //    the material's lastUnitCost is updated by a future receive.
  const totalCost = mat.lastUnitCost != null ? mat.lastUnitCost * qty : null;

  const wasteRows = (await sql(
    `WITH ins AS (
       INSERT INTO waste_entries (
         id, "tenantId", "materialId", qty, unit,
         "unitCost", "totalCost", reason, note, "userId", "createdAt"
       ) VALUES (
         $1, $2, $3, $4, $5::"Unit",
         $6, $7, $8::"WasteReason", $9, $10, NOW()
       )
       ON CONFLICT (id) DO NOTHING
       RETURNING id
     )
     SELECT id, true AS was_inserted FROM ins
     UNION ALL
     SELECT id, false AS was_inserted FROM waste_entries
      WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM ins)
     LIMIT 1`,
    [id, user.tenantId, materialId, qty, unit, mat.lastUnitCost, totalCost, reason, note ?? null, user.id ?? null],
  )) as Array<{ id: string; was_inserted: boolean }>;

  if (wasteRows.length === 0) {
    return NextResponse.json({ error: 'Waste insert failed' }, { status: 500 });
  }
  const wasInserted = wasteRows[0].was_inserted === true;

  // 3. Stock deduction — only on fresh insert. Retries replay the audit
  //    row but skip the deduction (FIFO would otherwise double-count).
  if (wasInserted) {
    try {
      await recordWasteDeduction(
        user.tenantId,
        { materialId: mat.id, materialName: mat.name, qty, unit },
        { wasteId: id, userId: user.id ?? null, note: note ?? null },
      );
    } catch (e) {
      // The waste_entries row is already in. Surface a clear error so the
      // caller can either retry (after receiving stock) or compensating-
      // delete the row manually if needed. Hard rule #13: don't silently
      // swallow.
      const msg = (e as Error).message ?? 'Stock deduction failed';
      console.error('[inventory/waste POST]', msg);
      return NextResponse.json({ error: msg }, { status: 409 });
    }
  }

  return NextResponse.json({
    ok: true,
    waste: { id, materialId, qty, unit, reason, note: note ?? null },
    idempotent: !wasInserted,
  });
}
