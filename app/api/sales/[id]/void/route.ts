/**
 * Sale void endpoint.
 *
 *   POST /api/sales/:id/void  { reason: string }
 *
 * Side effects (atomic):
 *   - Flip sale_transactions.status COMPLETED → VOIDED
 *   - Stamp voidedAt, voidedBy, voidReason
 *   - Restore finishedGoodsOnHand for BATCH lines (sum of line.qty back)
 *   - If modeAtCreation = 'FULL': insert compensating stock_movements
 *     (reason='SALE_VOID') and bump batch.remainingQty back up.
 *   - If modeAtCreation = 'POS_PAUSED': nothing further — there were no
 *     raw-material deductions to reverse.
 *
 * Idempotency:
 *   The status flip is the single idempotency gate. If the sale is already
 *   VOIDED, the UPDATE returns zero rows and no further work is done; we
 *   return 200 with `idempotent: true` so retries from the offline outbox
 *   are safe.
 *
 * RBAC: OWNER or MANAGER only.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/neonHttp';
import { reverseSaleMaterialMovements } from '@/lib/stock/ledger';

const Schema = z.object({
  reason: z.string().trim().min(1).max(500),
});

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const user = await requireUser();
  if (user.role !== 'OWNER' && user.role !== 'MANAGER') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { id: saleId } = await params;
  if (!saleId) return NextResponse.json({ error: 'missing sale id' }, { status: 400 });

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
  const { reason } = parsed.data;

  // Atomic CTE:
  //   1. Try to claim the void by flipping COMPLETED → VOIDED. Returns the
  //      row only if it was actually flipped (status='COMPLETED' on entry).
  //   2. If claimed, increment finishedGoodsOnHand for every BATCH line on
  //      this sale by line.qty (drinks/DIRECT have no FG to restore — they
  //      get handled below if mode was FULL).
  //   3. Return either the claimed row (fresh void) or the existing one
  //      (idempotent retry) so the caller can branch on `wasClaimed`.
  const rows = (await sql(
    `WITH claimed AS (
       UPDATE sale_transactions
          SET status = 'VOIDED',
              "voidReason" = $4,
              "voidedAt" = NOW(),
              "voidedBy" = $5
        WHERE id = $1 AND "tenantId" = $2 AND status = 'COMPLETED'
        RETURNING id, "modeAtCreation"
     ),
     fg_restore AS (
       UPDATE sellable_items s
          SET "finishedGoodsOnHand" = s."finishedGoodsOnHand" + sub.qty,
              "updatedAt" = NOW()
         FROM (
           SELECT sl."itemId", SUM(sl.qty)::float8 AS qty
             FROM sale_lines sl
             JOIN sellable_items si ON si.id = sl."itemId"
            WHERE sl."saleId" = (SELECT id FROM claimed)
              AND si."productionMode" = 'BATCH'
              AND si."tenantId" = $2
            GROUP BY sl."itemId"
         ) sub
        WHERE s.id = sub."itemId" AND s."tenantId" = $2
       RETURNING s.id
     )
     SELECT
       (SELECT "modeAtCreation" FROM claimed) AS "modeAtCreation",
       EXISTS (SELECT 1 FROM claimed) AS was_claimed,
       (SELECT status FROM sale_transactions WHERE id = $1 AND "tenantId" = $2) AS current_status`,
    [saleId, user.tenantId, /* unused $3 placeholder */null, reason, user.id ?? null],
  )) as Array<{ modeAtCreation: string | null; was_claimed: boolean; current_status: string | null }>;

  const row = rows[0];
  if (!row || row.current_status === null) {
    return NextResponse.json({ error: 'Sale not found' }, { status: 404 });
  }

  const wasClaimed = row.was_claimed === true;

  // Material reversal — only on a fresh claim AND the original sale was in
  // FULL mode (POS_PAUSED never deducted raw materials, so there's nothing
  // to put back).
  if (wasClaimed && row.modeAtCreation === 'FULL') {
    try {
      await reverseSaleMaterialMovements(user.tenantId, saleId, user.id ?? null);
    } catch (e) {
      // Status is already flipped + BATCH FG is already restored. The raw
      // materials reversal failed mid-way; surface a clear error so the
      // owner can run repair, but don't try to un-do the void.
      const msg = (e as Error).message ?? 'Material reversal failed';
      console.error('[sales/void POST]', msg);
      return NextResponse.json(
        { error: `Sale voided but material reversal failed: ${msg}` },
        { status: 207 }, // 207 Multi-Status — partial success
      );
    }
  }

  return NextResponse.json({
    ok: true,
    saleId,
    status: 'VOIDED',
    idempotent: !wasClaimed,
    modeAtCreation: row.modeAtCreation,
  });
}
