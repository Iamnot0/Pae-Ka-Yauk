/**
 * POST /api/stocks/adjust — log a manual finished-goods adjustment.
 *
 * Used by the inline DMG/FOC popovers on the /stocks page. Each call writes
 * a single `stock_adjustments` row and, for BATCH items, atomically
 * decrements `sellable_items.finishedGoodsOnHand` so the UI on-hand value
 * matches reality on the next reload.
 *
 * Why this isn't routed through `lib/stock/ledger.ts`: that ledger writes
 * `stock_movements` (raw materials). This endpoint only touches
 * sellable_items finished goods — different audit table by design.
 *
 * For DIRECT items (Latte etc.), there's no `finishedGoodsOnHand` to
 * decrement (drinks are made-to-order). We still record the adjustment
 * event for reporting; just no balance to subtract.
 *
 * Stock-in note: positive-delta stock-ins (RECEIVED finished goods from a
 * supplier) flow through `/api/stocks/receive` → `production_batches`
 * (with `source = 'RECEIVED'`), NOT through this endpoint. Every category
 * accepted here (DAMAGED / FOC / SPOILED / OTHER) is a DECREMENT.
 *
 * Idempotency:
 *   POSTing the same body twice (same `id`) yields ONE row in stock_adjustments
 *   and ONE finishedGoodsOnHand decrement. ON CONFLICT (id) DO NOTHING handles
 *   the write side; fg_apply joins to inserted (not existing) so retries are
 *   no-ops.
 *
 *   Contract: client MUST resend an identical body on retry. If the same `id`
 *   arrives with a different body, the server returns the canonical persisted
 *   state from the FIRST POST.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/neonHttp';
import { ULID_REGEX } from '@/lib/client/ulid';

export const runtime = 'nodejs';

const CATEGORIES = ['DAMAGED', 'FOC', 'SPOILED', 'OTHER'] as const;

const schema = z.object({
  id: z.string().regex(ULID_REGEX),
  // Mode policy stamp — accepted for forward-compat with the Phase 2 outbox
  // (sales/production stamp it on the row; stock_adjustments has no column
  // for it yet, so we accept-and-ignore here rather than reject the field).
  modeAtCreation: z.enum(['POS_PAUSED', 'FULL']).optional(),
  itemId: z.string().min(1),
  category: z.enum(CATEGORIES),
  qty: z.number().int().positive().max(10_000),
  reason: z.string().trim().max(80).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
});

/**
 * GET /api/stocks/adjust?itemId=<id>&limit=<n> — recent DMG/FOC entries for
 * one item, newest first. Powers the "Recent entries" panel in the
 * adjustment dialog so the cashier can see what's already been logged.
 */
export async function GET(req: Request) {
  const user = await requireUser();
  const url = new URL(req.url);
  const itemId = url.searchParams.get('itemId');
  if (!itemId) {
    return NextResponse.json({ error: 'itemId is required' }, { status: 400 });
  }
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 20), 1), 100);

  const rows = (await sql(
    `SELECT a.id, a.category, a.qty::float8 AS qty, a.reason, a.note,
            a."createdAt"::text                  AS "createdAt",
            COALESCE(u.name, u.email)            AS "byName"
       FROM stock_adjustments a
       LEFT JOIN users u ON u.id = a."userId"
      WHERE a."tenantId" = $1 AND a."itemId" = $2
      ORDER BY a."createdAt" DESC
      LIMIT $3`,
    [user.tenantId, itemId, limit],
  )) as Array<{
    id: string;
    category: string;
    qty: number;
    reason: string | null;
    note: string | null;
    createdAt: string;
    byName: string | null;
  }>;

  return NextResponse.json({ ok: true, rows });
}

export async function POST(req: Request) {
  const user = await requireUser();

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { id: adjustmentId, itemId, category, qty, reason, note } = parsed.data;

  // Verify the item belongs to this tenant + grab its mode for branching.
  const itemRows = (await sql(
    `SELECT id, name, "productionMode"::text AS "productionMode",
            "finishedGoodsOnHand"::float8 AS "onHand"
     FROM sellable_items
     WHERE "tenantId" = $1 AND id = $2 AND "deletedAt" IS NULL`,
    [user.tenantId, itemId],
  )) as Array<{ id: string; name: string; productionMode: 'DIRECT' | 'BATCH'; onHand: number }>;

  if (itemRows.length === 0) {
    return NextResponse.json({ error: 'Item not found' }, { status: 404 });
  }
  const item = itemRows[0];

  // Block over-adjustment for BATCH items (can't damage 5 if only 3 on hand).
  // Skipped on retry: if the row already exists with the same id, we'll
  // surface the canonical state below — no need to re-validate inventory
  // bounds for a write that already happened.
  if (item.productionMode === 'BATCH' && qty > item.onHand) {
    const [existing] = (await sql(
      `SELECT 1 FROM stock_adjustments WHERE id = $1 AND "tenantId" = $2`,
      [adjustmentId, user.tenantId],
    )) as Array<{ '?column?': number }>;
    if (!existing) {
      return NextResponse.json(
        {
          error: `Can't adjust ${qty} of "${item.name}" — only ${item.onHand} on hand. Bake more first or reduce the quantity.`,
          onHand: item.onHand,
        },
        { status: 400 },
      );
    }
  }

  // Idempotent compound write: insert adjustment + decrement on-hand atomically.
  //
  // Idempotency design (Plan 1, Task 6):
  //   - `existing` looks up by primary key (the client-minted ULID).
  //   - `inserted` does ON CONFLICT (id) DO NOTHING so a retry returns zero
  //     rows from this CTE.
  //   - `fg_apply` JOINS to `inserted` so the decrement only fires when a
  //     row was actually inserted. Filtered to BATCH items only (DIRECT
  //     items have no finishedGoodsOnHand to subtract from).
  //   - The final SELECT UNION-ALLs the existing row when no insert
  //     happened so callers can read back `was_inserted` and decide whether
  //     to surface "saved" vs "already saved".
  try {
    const rows = (await sql(
      `WITH existing AS (
         SELECT id FROM stock_adjustments
         WHERE id = $1 AND "tenantId" = $2
       ),
       inserted AS (
         INSERT INTO stock_adjustments
           (id, "tenantId", "itemId", qty, category, reason, note, "userId", "createdAt")
         VALUES
           ($1, $2, $3, $4, $5::"StockAdjustmentCategory", $6, $7, $8, NOW())
         ON CONFLICT (id) DO NOTHING
         RETURNING id, "itemId", qty
       ),
       fg_apply AS (
         UPDATE sellable_items s
         SET "finishedGoodsOnHand" = s."finishedGoodsOnHand" - i.qty,
             "updatedAt" = NOW()
         FROM inserted i
         WHERE s.id = i."itemId"
           AND s."tenantId" = $2
           AND s."productionMode" = 'BATCH'
         RETURNING s."finishedGoodsOnHand"::float8 AS "onHand"
       )
       SELECT id, true AS was_inserted FROM inserted
       UNION ALL
       SELECT id, false AS was_inserted FROM existing
       WHERE NOT EXISTS (SELECT 1 FROM inserted)
       LIMIT 1`,
      [adjustmentId, user.tenantId, itemId, qty, category, reason ?? null, note ?? null, user.id],
    )) as Array<{ id: string; was_inserted: boolean }>;

    if (rows.length === 0) {
      throw new Error('Adjustment insert produced no row and no existing row was found');
    }
    const wasInserted = rows[0].was_inserted === true;

    return NextResponse.json(
      { ok: true, adjustmentId, idempotent: !wasInserted },
      { status: 201 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Adjustment failed';
    console.error('[POST /api/stocks/adjust]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
