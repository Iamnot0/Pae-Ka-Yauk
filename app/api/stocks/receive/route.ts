import { NextResponse } from 'next/server';
import { z } from 'zod';
import { sql } from '@/lib/neonHttp';
import { requireUser } from '@/lib/auth';
import { ULID_REGEX } from '@/lib/client/ulid';
import { getInventoryMode } from '@/lib/featureMode';

/**
 * Receive Stocks endpoint — credit finished-goods on-hand for a sellable item
 * without going through the recipe/production flow. Used in PAUSED mode where
 * the bakery owner wants to track stock arriving from a supplier (or from an
 * un-recipe'd internal bake) without setting up the recipe first. Also works
 * in FULL mode as a parallel write path.
 *
 * Writes one production_batches row with source='RECEIVED', recipeId=NULL,
 * actualYield=qty. Credits sellable_items.finishedGoodsOnHand by qty.
 *
 * Idempotency:
 *   POSTing the same body twice (same `id`) yields ONE production_batches row
 *   and ONE finishedGoodsOnHand credit. ON CONFLICT (id) DO NOTHING handles the
 *   write side; fg_credit joins to inserted (not existing) so retries are no-ops.
 *
 *   Contract: client MUST resend an identical body on retry. If the same `id`
 *   arrives with a different body, the server returns the canonical persisted
 *   state from the FIRST POST.
 *
 * RBAC: OWNER or MANAGER only.
 */

const ReceiveSchema = z.object({
  id: z.string().regex(ULID_REGEX),
  itemId: z.string().min(1),
  qty: z.number().int().positive(),
  costPerUnit: z.number().nonnegative().optional(),
  note: z.string().trim().max(500).optional(),
  modeAtCreation: z.enum(['POS_PAUSED', 'FULL']).optional(),
  // Optional supplier-stamped expiry. Caller can pass null to clear.
  // Stored on production_batches.expiryDate so the Stocks page reads
  // "soonest-expiring batch" consistently for both bake + receive.
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

export async function POST(req: Request) {
  const user = await requireUser();
  if (user.role !== 'OWNER' && user.role !== 'MANAGER') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = ReceiveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const payload = parsed.data;

  // modeAtCreation: client-stamped wins; server fallback uses current tenant mode.
  // Not persisted on production_batches in v1 (no column), but accepted for
  // forward-compat with the Phase 2 outbox payload shape.
  const _modeAtCreation = payload.modeAtCreation ?? (await getInventoryMode(user.tenantId));

  // Verify the item belongs to this tenant. Catches client-side spoofing
  // and returns a clean 404 instead of a silent FK violation.
  const itemRows = (await sql(
    `SELECT id FROM sellable_items WHERE id = $1 AND "tenantId" = $2`,
    [payload.itemId, user.tenantId],
  )) as Array<{ id: string }>;
  if (itemRows.length === 0) {
    return NextResponse.json({ error: 'Item not found' }, { status: 404 });
  }

  try {
    const rows = (await sql(
      `WITH existing AS (
         SELECT id, "itemId", "actualYield" FROM production_batches WHERE id = $1
       ),
       inserted AS (
         INSERT INTO production_batches (
           id, "tenantId", "itemId", "recipeId", source,
           "batchCount", "expectedYield", "actualYield",
           "createdAt", notes, "expiryDate"
         )
         SELECT $1, $2, $3, NULL, 'RECEIVED',
                1, $4, $4,
                NOW(), $5, $6::date
         ON CONFLICT (id) DO NOTHING
         RETURNING id, "itemId", "actualYield"
       ),
       fg_credit AS (
         UPDATE sellable_items s
         SET "finishedGoodsOnHand" = s."finishedGoodsOnHand" + i."actualYield",
             "updatedAt" = NOW()
         FROM inserted i
         WHERE s.id = i."itemId" AND s."tenantId" = $2
       )
       SELECT id, "itemId", "actualYield"::float8 AS "actualYield", true AS was_inserted FROM inserted
       UNION ALL
       SELECT id, "itemId", "actualYield"::float8 AS "actualYield", false AS was_inserted FROM existing
       WHERE NOT EXISTS (SELECT 1 FROM inserted)
       LIMIT 1`,
      [payload.id, user.tenantId, payload.itemId, payload.qty, payload.note ?? null, payload.expiryDate ?? null],
    )) as Array<{ id: string; itemId: string; actualYield: number; was_inserted: boolean }>;

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Receive failed' }, { status: 500 });
    }

    const result = rows[0];
    return NextResponse.json({
      ok: true,
      batch: {
        id: result.id,
        itemId: result.itemId,
        actualYield: result.actualYield,
      },
      idempotent: !result.was_inserted,
      modeAtCreation: _modeAtCreation,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[stocks/receive POST]', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
