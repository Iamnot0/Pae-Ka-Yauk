/**
 * Production endpoint — baker logs a batch.
 *
 *   POST /api/production  { id, itemId, batchCount, actualYield?, notes?, modeAtCreation? }
 *
 * Side effects (FULL mode):
 *   - creates a production_batches row (audit anchor)
 *   - FIFO-deducts every recipe ingredient (reason=PRODUCTION_CONSUME, linked via productionBatchId)
 *   - increments sellable_items.finishedGoodsOnHand by actualYield
 *
 * Side effects (POS_PAUSED mode):
 *   - creates a production_batches row (still — owner sees a bake history)
 *   - increments sellable_items.finishedGoodsOnHand by actualYield
 *   - SKIPS raw-material deduction entirely (no stock_movements / stock_batches writes)
 *
 * Guardrails:
 *   - item must be BATCH-mode
 *   - item must have an active recipe
 *   - actualYield defaults to recipe.yield × batchCount if omitted
 *
 * Idempotency:
 *   POSTing the same body twice (same `id`) yields ONE row in production_batches
 *   and ONE finishedGoodsOnHand credit. ON CONFLICT (id) DO NOTHING handles the
 *   write side; the finishedGoodsOnHand UPDATE is folded into the same CTE and
 *   joined to `inserted` so it only fires when a row was actually inserted.
 *   Raw-material BOM deduction is gated on `wasInserted` returned from the CTE
 *   AND on shouldDeductRawMaterials(modeAtCreation) — so a retry after a
 *   committed write never double-deducts ingredients.
 *
 *   Contract: client MUST resend an identical body on retry (same id, same
 *   itemId, same batchCount, same actualYield). If the same `id` arrives with
 *   a different body, the server returns the canonical persisted state
 *   (computed from the FIRST POST) — the second POST's payload is ignored
 *   beyond the id match. Misbehaving clients that mutate retry bodies will
 *   see a response that doesn't reflect their request; this is by design.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/neonHttp';
import { getActiveRecipe } from '@/lib/repos/recipes';
import { computeDeductions, type SaleLineForBom, type RecipeForBom } from '@/lib/stock/bom';
import { recordProductionDeductions, type DeductSpec } from '@/lib/stock/ledger';
import { ULID_REGEX } from '@/lib/client/ulid';
import { getInventoryMode, shouldDeductRawMaterials, type InventoryMode } from '@/lib/featureMode';
import type { Unit } from '@/lib/repos/materials';

const Schema = z.object({
  id: z.string().regex(ULID_REGEX),
  modeAtCreation: z.enum(['POS_PAUSED', 'FULL']).optional(),
  itemId: z.string().min(1),
  batchCount: z.number().positive().default(1),
  actualYield: z.number().nonnegative().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
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
      { status: 400 }
    );
  }
  const { id: productionBatchId, itemId, batchCount, actualYield, notes } = parsed.data;

  // --- 0. Resolve mode policy stamp ---
  // Client may send modeAtCreation (Phase 2 outbox does that with the mode
  // captured at creation time on the device). If absent, server resolves from
  // the current tenant mode. Once a deduction has been written, it's locked
  // in — even if the tenant flips PAUSED→FULL later, this bake's behavior
  // followed its original policy.
  const modeAtCreation: InventoryMode =
    parsed.data.modeAtCreation ?? (await getInventoryMode(user.tenantId));

  // 1. Validate item — must be BATCH-mode. Also pulls shelfLifeDays so we
  //    can stamp this bake's expiry date on the production_batches row.
  const [item] = (await sql(
    `SELECT id, name, "productionMode", "shelfLifeDays",
            "finishedGoodsOnHand"::float8 AS "finishedGoodsOnHand"
     FROM sellable_items
     WHERE "tenantId" = $1 AND id = $2 AND "deletedAt" IS NULL AND active = true`,
    [user.tenantId, itemId]
  )) as Array<{ id: string; name: string; productionMode: 'DIRECT' | 'BATCH'; shelfLifeDays: number | null; finishedGoodsOnHand: number }>;

  if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 });
  if (item.productionMode !== 'BATCH') {
    return NextResponse.json(
      { error: `Item "${item.name}" is set to DIRECT mode — no bake flow. Switch it to BATCH in item settings first.` },
      { status: 400 }
    );
  }

  // 2. Load recipe
  const recipe = await getActiveRecipe(user.tenantId, itemId);
  if (!recipe) {
    return NextResponse.json(
      { error: `Item "${item.name}" has no active recipe — can't bake without one.` },
      { status: 400 }
    );
  }

  // 3. Compute deductions via BOM engine — only if we'll actually deduct.
  //    In POS_PAUSED mode we skip BOM entirely (no stock_movements writes);
  //    expectedYield is still computed for display + persistence.
  const expectedYield = recipe.yield * batchCount;
  const yieldUsed = actualYield ?? expectedYield;

  let deductions: DeductSpec[] = [];
  if (shouldDeductRawMaterials(modeAtCreation)) {
    const materialIds = [...new Set(recipe.ingredients.map(i => i.materialId))];
    const matRows = materialIds.length ? (await sql(
      `SELECT id, name, "baseUnit" FROM raw_materials
       WHERE "tenantId" = $1 AND id = ANY($2::text[]) AND "deletedAt" IS NULL`,
      [user.tenantId, materialIds]
    )) as Array<{ id: string; name: string; baseUnit: Unit }> : [];
    const baseUnits = Object.fromEntries(matRows.map(m => [m.id, m.baseUnit]));
    const namesById = Object.fromEntries(matRows.map(m => [m.id, m.name]));

    const bomLines: SaleLineForBom[] = [{ itemId, qty: expectedYield }];
    const bomRecipes: Record<string, RecipeForBom> = {
      [itemId]: {
        itemId,
        yield: recipe.yield,
        yieldUnit: recipe.yieldUnit,
        ingredients: recipe.ingredients.map(i => ({
          materialId: i.materialId,
          quantity: i.quantity,
          unit: i.unit,
        })),
      },
    };

    try {
      deductions = computeDeductions(bomLines, bomRecipes, baseUnits)
        .map(d => ({ ...d, materialName: namesById[d.materialId] }));
    } catch (e) {
      return NextResponse.json({ error: `BOM failed: ${(e as Error).message}` }, { status: 400 });
    }
  }

  // 4. Persist production_batches + finished-goods credit (ONE atomic CTE)
  //
  // Idempotency design (Plan 1, Task 5):
  //   - `existing` looks up by primary key (the client-minted ULID).
  //   - `inserted` does ON CONFLICT (id) DO NOTHING so a retry returns zero
  //     rows from this CTE.
  //   - `fg_credit` JOINS to `inserted` so the increment only fires when a
  //     row was actually inserted. This is the key idempotency mechanism for
  //     the finishedGoodsOnHand counter — a retry never double-credits.
  //   - The final SELECT UNION-ALLs the existing row when no insert happened
  //     so callers can always read back the canonical actualYield + new
  //     finishedGoodsOnHand and see whether this was a fresh insert
  //     (`was_inserted` flag), which gates the raw-material deduction call
  //     downstream.
  try {
    const rows = (await sql(
      `WITH existing AS (
         SELECT id, "actualYield"::float8 AS "actualYield"
         FROM production_batches WHERE id = $1
       ),
       inserted AS (
         INSERT INTO production_batches (
           id, "tenantId", "outletId", "itemId", "recipeId", "recipeVersion",
           "batchCount", "expectedYield", "actualYield",
           "createdAt", "createdBy", notes, "expiryDate"
         )
         SELECT $1, $2, $3, $4, $5, $6,
                $7, $8, $9,
                NOW(), $10, $11,
                CASE
                  WHEN $12::int IS NULL THEN NULL
                  ELSE ((NOW() AT TIME ZONE 'Asia/Yangon')::date + ($12::int * INTERVAL '1 day'))::date
                END
         ON CONFLICT (id) DO NOTHING
         RETURNING id, "actualYield"::float8 AS "actualYield"
       ),
       fg_credit AS (
         UPDATE sellable_items s
         SET "finishedGoodsOnHand" = s."finishedGoodsOnHand" + i."actualYield",
             "updatedAt" = NOW()
         FROM inserted i
         WHERE s.id = $4
           AND s."tenantId" = $2
         RETURNING s."finishedGoodsOnHand"::float8 AS on_hand
       ),
       fg_existing AS (
         SELECT "finishedGoodsOnHand"::float8 AS on_hand
         FROM sellable_items
         WHERE id = $4 AND "tenantId" = $2
       )
       SELECT
         (SELECT "actualYield" FROM inserted)  AS inserted_yield,
         (SELECT "actualYield" FROM existing)  AS existing_yield,
         COALESCE(
           (SELECT on_hand FROM fg_credit),
           (SELECT on_hand FROM fg_existing)
         ) AS on_hand,
         EXISTS (SELECT 1 FROM inserted) AS was_inserted`,
      [
        productionBatchId,             // $1
        user.tenantId,                 // $2
        null,                          // $3 outletId
        itemId,                        // $4
        recipe.id,                     // $5 recipeId
        recipe.version,                // $6 recipeVersion
        batchCount,                    // $7
        expectedYield,                 // $8
        yieldUsed,                     // $9
        user.id,                       // $10 createdBy
        notes ?? null,                 // $11
        item.shelfLifeDays ?? null,    // $12 — drives the expiryDate column
      ]
    )) as Array<{
      inserted_yield: number | null;
      existing_yield: number | null;
      on_hand: number | null;
      was_inserted: boolean;
    }>;

    const row = rows[0];
    if (!row) {
      throw new Error('Production insert produced no row and no existing row was found');
    }
    const wasInserted = row.was_inserted === true;
    // On retry: existing_yield wins. On fresh insert: inserted_yield. Either way,
    // `on_hand` reflects the canonical post-write counter (fg_credit on insert,
    // fg_existing on retry).
    const persistedYield = wasInserted ? row.inserted_yield : row.existing_yield;
    const finishedGoodsOnHand = Number(row.on_hand ?? 0);

    // 5. Raw-material deduction — ONLY when this was a fresh insert AND
    //    mode is FULL. On retry (wasInserted = false), we already stamped
    //    the original deductions; re-running would double-count. On
    //    POS_PAUSED, we never write stock_movements at all (the whole
    //    point of the mode). Finished-goods credit was already done
    //    atomically in the CTE above via `fg_credit` joining to `inserted`.
    if (wasInserted && shouldDeductRawMaterials(modeAtCreation) && deductions.length > 0) {
      await recordProductionDeductions(user.tenantId, deductions, {
        productionBatchId,
        userId: user.id,
        outletId: null,
        note: notes ?? null,
      });
    }

    return NextResponse.json({
      productionBatchId,
      itemId,
      itemName: item.name,
      batchCount,
      expectedYield,
      actualYield: Number(persistedYield ?? yieldUsed),
      finishedGoodsOnHand,
      modeAtCreation,
      deductions: deductions.map(d => ({ materialId: d.materialId, qty: d.qty, unit: d.unit })),
      idempotent: !wasInserted,
    }, { status: 201 });
  } catch (e) {
    const msg = (e as Error).message ?? '';
    console.error('[production POST]', msg);
    return NextResponse.json({ error: msg || 'Production failed' }, { status: 500 });
  }
}
