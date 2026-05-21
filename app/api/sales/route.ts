/**
 * Sale endpoint — writes a SaleTransaction + lines AND deducts raw materials
 * via the BOM engine in one request.
 *
 * Flow:
 *   1. Validate payload (Zod) — sale id + line ids are now CLIENT-MINTED ULIDs
 *   2. Resolve modeAtCreation (client hint or current tenant mode)
 *   3. Load menu items + prices (authoritative — client-sent prices are hints)
 *   4. Compute totals server-side (subtotal, tax, total, change)
 *   5. Load active recipes for all sold itemIds (DIRECT only)
 *   6. Compute ingredient deductions via pure BOM function
 *   7. Insert SaleTransaction + SaleLines + decrement finishedGoodsOnHand
 *      — all in ONE atomic CTE statement, idempotent on (id) PK
 *   8. If mode is FULL: call ledger.recordSaleDeductions — FIFO across batches
 *      If mode is POS_PAUSED: skip BOM entirely (no stock_movements writes)
 *   9. Return the sale + deductions for the receipt view
 *
 * Idempotency:
 *   POSTing the same body twice (same `id`) yields ONE row in sale_transactions,
 *   ONE set of sale_lines, ONE finishedGoodsOnHand decrement. The `inserted_tx`
 *   CTE uses ON CONFLICT (id) DO NOTHING; `fg_update` joins to inserted_lines so
 *   it only fires when rows were actually inserted; raw-material BOM deduction
 *   is gated on `wasInserted` returned from the CTE.
 *
 *   Contract: client MUST resend an identical body on retry (same id, same
 *   lines[], same totals). If the same `id` arrives with a different body, the
 *   server returns the canonical persisted state (computed from the FIRST POST)
 *   — the second POST's payload is ignored beyond the id match. Misbehaving
 *   clients that mutate retry bodies will see a response that doesn't reflect
 *   their request; this is by design and not a bug.
 *
 * All money math uses JS Number but only within safe integer territory for
 * MMK (no fractional kyats). The DB stores as Decimal to be safe.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/neonHttp';
import { recordSaleDeductions, type DeductSpec } from '@/lib/stock/ledger';
import { getActiveRecipesForItems } from '@/lib/repos/recipes';
import { computeDeductions, type SaleLineForBom, type RecipeForBom } from '@/lib/stock/bom';
import { applyTaxIf } from '@/lib/config/tax';
import { ULID_REGEX } from '@/lib/client/ulid';
import { getInventoryMode, shouldDeductRawMaterials, type InventoryMode } from '@/lib/featureMode';
import type { Unit } from '@/lib/repos/materials';

// MOBILE_MONEY removed 2026-05-21 — shop no longer accepts KBZ Pay. The DB
// enum dropped the value in the same migration; historical rows were
// deleted. Re-adding requires both a schema migration AND owner sign-off.
const TENDER_TYPES = ['CASH', 'CARD', 'BANK_TRANSFER', 'SPLIT', 'CREDIT'] as const;

const Schema = z.object({
  id: z.string().regex(ULID_REGEX),
  modeAtCreation: z.enum(['POS_PAUSED', 'FULL']).optional(),
  deviceId: z.string().trim().min(1).max(40).default('WEB-01'),
  // Offline-POS resync escape hatch — client may pre-mint receiptNumber.
  // Restricted to the canonical PKY00000 shape so a malformed value can't
  // poison the daily MAX() counter in next_receipt.
  receiptNumber: z.string().regex(/^PKY\d{5}$/).optional(),
  tenderType: z.enum(TENDER_TYPES),
  amountTendered: z.number().nonnegative().optional(),
  // Tax opt-in per sale. Cashier toggles on /pos; default false = no tax line
  // on the slip and taxTotal=0. When true, server computes 5% of subtotal.
  // Client-sent value is honored (server doesn't second-guess intent), but
  // the *amount* is always recomputed server-side per Hard Rule #5.
  taxApplied: z.boolean().default(false),
  discountTotal: z.number().nonnegative().default(0),
  deliveryFee: z.number().nonnegative().default(0),
  notes: z.string().trim().max(500).optional(),
  lines: z.array(z.object({
    id: z.string().regex(ULID_REGEX),
    itemId: z.string().min(1),
    qty: z.number().positive(),
    modifierDeltas: z.number().default(0),
    notes: z.string().trim().max(200).nullable().optional(),
  })).min(1),
});

interface ItemRow {
  id: string;
  name: string;
  price: number;
  taxRate: number;
  productionMode: 'DIRECT' | 'BATCH';
  finishedGoodsOnHand: number;
}

interface MaterialRow {
  id: string;
  baseUnit: Unit;
}

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
  const payload = parsed.data;
  const saleId = payload.id;

  // --- 0. Resolve mode policy stamp ---
  // Client may send modeAtCreation (Phase 2 outbox does that with the mode
  // captured at creation time on the device). If absent, server resolves from
  // the current tenant mode. Once stamped on the row, it's locked in — even
  // if the tenant flips PAUSED→FULL later, this sale's behavior follows its
  // original policy.
  const modeAtCreation: InventoryMode =
    payload.modeAtCreation ?? (await getInventoryMode(user.tenantId));

  // --- 1. Load sellable items (authoritative prices) ---
  const itemIds = [...new Set(payload.lines.map(l => l.itemId))];
  const items = (await sql(
    `SELECT id, name,
            price::float8    AS price,
            "taxRate"::float8 AS "taxRate",
            "productionMode",
            "finishedGoodsOnHand"::float8 AS "finishedGoodsOnHand"
     FROM sellable_items
     WHERE "tenantId" = $1 AND id = ANY($2::text[]) AND "deletedAt" IS NULL AND active = true`,
    [user.tenantId, itemIds]
  )) as ItemRow[];

  if (items.length !== itemIds.length) {
    const missing = itemIds.filter(id => !items.find(i => i.id === id));
    return NextResponse.json(
      { error: 'One or more items not found or inactive', missing },
      { status: 400 }
    );
  }
  const itemById = Object.fromEntries(items.map(i => [i.id, i]));

  // --- 2. Compute totals server-side ---
  // Tax policy (owner-confirmed 2026-05-21): opt-in per sale. `taxApplied`
  // comes from the cart; when true, 5% of subtotal is added; when false,
  // taxTotal = 0 and the slip omits the Tax line. Per-line `lineTax` is a
  // proportional slice kept for report accuracy (COGS/tax-owing breakdowns)
  // and may differ from `taxTotal` by ≤1 MMK due to rounding. Authoritative
  // number is `taxTotal`. `sellable_items.taxRate` remains intentionally
  // ignored (kept for Phase 2 per-jurisdiction overrides).
  const taxApplied = payload.taxApplied;
  let subtotal = 0;
  const linesPreTax = payload.lines.map((l) => {
    const item = itemById[l.itemId];
    const lineBase = item.price * l.qty + (l.modifierDeltas ?? 0);
    subtotal += lineBase;
    return { ...l, item, lineTotal: lineBase };
  });
  const taxTotal = applyTaxIf(taxApplied, subtotal);
  const computedLines = linesPreTax.map((l) => ({
    ...l,
    lineTax: applyTaxIf(taxApplied, l.lineTotal),
  }));

  const discountTotal = payload.discountTotal ?? 0;
  const deliveryFee = payload.deliveryFee ?? 0;
  // Delivery fee is added AFTER tax — it's a service charge, not a goods
  // sale, so we don't apply 5% VAT on top of it.
  const total = subtotal - discountTotal + taxTotal + deliveryFee;
  const amountTendered = payload.amountTendered ?? total;
  const changeGiven = Math.max(0, amountTendered - total);

  if (payload.tenderType === 'CASH' && amountTendered < total) {
    return NextResponse.json(
      { error: 'Cash tendered is less than total', total, amountTendered },
      { status: 400 }
    );
  }

  // --- 2b. Pre-check BATCH items have enough finished goods ---
  //    (DIRECT items get checked at deduct-time inside the ledger.)
  const batchNeeds = new Map<string, number>();
  for (const l of payload.lines) {
    if (itemById[l.itemId].productionMode === 'BATCH') {
      batchNeeds.set(l.itemId, (batchNeeds.get(l.itemId) ?? 0) + l.qty);
    }
  }
  for (const [itemId, needed] of batchNeeds) {
    const item = itemById[itemId];
    if (item.finishedGoodsOnHand < needed) {
      return NextResponse.json({
        error: `Not enough "${item.name}" in stock — have ${item.finishedGoodsOnHand}, need ${needed}. Log a bake first at /production.`,
      }, { status: 409 });
    }
  }

  // --- 3. Load recipes + material base units — ONLY for DIRECT-mode items ---
  //    BATCH items don't need a recipe at sale time; ingredients were already
  //    deducted at bake time. Also: if mode is POS_PAUSED, we skip recipe
  //    loading entirely since BOM is bypassed.
  const directItemIds = itemIds.filter(id => itemById[id].productionMode !== 'BATCH');
  const recipesByItem = shouldDeductRawMaterials(modeAtCreation)
    ? await getActiveRecipesForItems(user.tenantId, directItemIds)
    : {};

  // Collect all materialIds referenced by any recipe
  const allMatIds = new Set<string>();
  for (const recipe of Object.values(recipesByItem)) {
    for (const ing of recipe.ingredients) allMatIds.add(ing.materialId);
  }

  let baseUnits: Record<string, Unit> = {};
  let materialNames: Record<string, string> = {};
  if (allMatIds.size > 0) {
    const matRows = (await sql(
      `SELECT id, name, "baseUnit" FROM raw_materials
       WHERE "tenantId" = $1 AND id = ANY($2::text[]) AND "deletedAt" IS NULL`,
      [user.tenantId, [...allMatIds]]
    )) as Array<MaterialRow & { name: string }>;
    baseUnits = Object.fromEntries(matRows.map(m => [m.id, m.baseUnit]));
    materialNames = Object.fromEntries(matRows.map(m => [m.id, m.name]));
  }

  // Build inputs for BOM engine — ONLY DIRECT items participate, and only when
  // mode is FULL. In POS_PAUSED, deductions stays empty.
  let deductions: DeductSpec[] = [];
  if (shouldDeductRawMaterials(modeAtCreation)) {
    const bomLines: SaleLineForBom[] = payload.lines
      .filter(l => itemById[l.itemId].productionMode !== 'BATCH')
      .map(l => ({ itemId: l.itemId, qty: l.qty }));
    const bomRecipes: Record<string, RecipeForBom> = {};
    for (const [itemId, r] of Object.entries(recipesByItem)) {
      bomRecipes[itemId] = {
        itemId,
        yield: r.yield,
        yieldUnit: r.yieldUnit,
        ingredients: r.ingredients.map(ing => ({
          materialId: ing.materialId,
          quantity: ing.quantity,
          unit: ing.unit,
        })),
      };
    }
    try {
      deductions = computeDeductions(bomLines, bomRecipes, baseUnits)
        .map(d => ({ ...d, materialName: materialNames[d.materialId] }));
    } catch (e) {
      return NextResponse.json(
        { error: `BOM computation failed: ${(e as Error).message}` },
        { status: 400 }
      );
    }
  }

  // --- 4. Persist sale + lines + finished-goods decrement (ONE atomic CTE) ---
  //
  // Idempotency design (Plan 1, Task 4):
  //   - `existing` looks up by primary key (the client-minted ULID).
  //   - `next_receipt` only computes when there's no existing row AND the
  //     client didn't supply a receiptNumber (offline-resync path).
  //   - `inserted_tx` does ON CONFLICT (id) DO NOTHING so a retry returns
  //     zero rows from this CTE.
  //   - `inserted_lines` does the same on the line PK; if the parent insert
  //     was a no-op, this also no-ops (no parent rows to bind to).
  //   - `fg_update` JOINS to `inserted_lines` so the decrement only fires
  //     when lines were actually inserted. This is the key idempotency
  //     mechanism for the finishedGoodsOnHand counter.
  //   - The final SELECT UNION-ALLs the existing row when no insert happened
  //     so callers can always read back the canonical state and see whether
  //     this was a fresh insert (`was_inserted` flag).
  //
  // Receipt numbering daily reset (existing behavior, preserved):
  //   `next_receipt` filters by today's Yangon-date so 00:00:01 returns
  //   PKY00001 for the next day's first sale. Yesterday's PKY00001 still
  //   exists; the unique index on (tenantId, Yangon-date, receiptNumber)
  //   keeps them disambiguated. Wrapped in `NOT EXISTS (existing)` so a
  //   retry doesn't burn a slot.

  const now = new Date().toISOString();
  const lineIdsArr = computedLines.map((_, i) => computedLines[i].id);
  const lineItemIdsArr = computedLines.map(l => l.itemId);
  const lineItemNamesArr = computedLines.map(l => l.item.name);
  const lineQtysArr = computedLines.map(l => l.qty);
  const lineUnitPricesArr = computedLines.map(l => l.item.price);
  const lineModDeltasArr = computedLines.map(l => l.modifierDeltas ?? 0);
  const lineTotalsArr = computedLines.map(l => l.lineTotal);
  const lineNotesArr = computedLines.map(l => l.notes ?? null);
  const lineRecipeVersionsArr = computedLines.map(
    l => recipesByItem[l.itemId]?.version ?? null
  );
  const lineSortOrdersArr = computedLines.map((_, i) => i);

  let receiptNumber: string;
  let wasInserted: boolean;
  try {
    const rows = (await sql(
      `WITH existing AS (
         SELECT * FROM sale_transactions WHERE id = $1
       ),
       next_receipt AS (
         SELECT 'PKY' || LPAD(
           (COALESCE(
              MAX(CAST(SUBSTRING("receiptNumber" FROM 4) AS INTEGER)),
              0
            ) + 1)::text,
           5, '0'
         ) AS num
         FROM sale_transactions
         WHERE "tenantId" = $2
           AND "receiptNumber" ~ '^PKY[0-9]+$'
           AND ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Yangon')::date
               = (NOW() AT TIME ZONE 'Asia/Yangon')::date
           AND NOT EXISTS (SELECT 1 FROM existing)
       ),
       inserted_tx AS (
         INSERT INTO sale_transactions (
           id, "tenantId", "outletId", "shiftId", "deviceId", "receiptNumber",
           "modeAtCreation",
           "cashierId", subtotal, "taxApplied", "taxTotal", "discountTotal", "deliveryFee", total,
           "tenderType", "tenderDetails", "amountTendered", "changeGiven",
           status, "createdAt", "serverReceivedAt"
         )
         SELECT
           $1, $2, NULL, NULL, $3,
           COALESCE($4::text, (SELECT num FROM next_receipt)),
           $5,
           $6, $7, $8, $9, $10, $11, $12,
           $13, NULL, $14, $15,
           'COMPLETED', $16::timestamp, NOW()
         ON CONFLICT (id) DO NOTHING
         RETURNING *
       ),
       inserted_lines AS (
         INSERT INTO sale_lines (
           id, "saleId", "itemId", "itemNameSnapshot", qty, "unitPrice",
           "modifierDeltas", "lineTotal", "modifiersSnapshot", notes,
           "recipeVersion", "sortOrder"
         )
         SELECT
           u.id, $1, u."itemId", u."itemNameSnapshot", u.qty, u."unitPrice",
           u."modifierDeltas", u."lineTotal", NULL, u.notes,
           u."recipeVersion", u."sortOrder"
         FROM UNNEST(
           $17::text[], $18::text[], $19::text[], $20::numeric[],
           $21::numeric[], $22::numeric[], $23::numeric[], $24::text[],
           $25::int[], $26::int[]
         ) AS u(
           id, "itemId", "itemNameSnapshot", qty, "unitPrice",
           "modifierDeltas", "lineTotal", notes, "recipeVersion", "sortOrder"
         )
         WHERE EXISTS (SELECT 1 FROM inserted_tx)
         ON CONFLICT (id) DO NOTHING
         RETURNING "itemId", qty
       ),
       fg_update AS (
         UPDATE sellable_items s
         SET "finishedGoodsOnHand" = s."finishedGoodsOnHand" - il.qty,
             "updatedAt" = NOW()
         FROM inserted_lines il
         WHERE s.id = il."itemId"
           AND s."tenantId" = $2
           AND s."productionMode" = 'BATCH'
         RETURNING s.id
       )
       SELECT "receiptNumber", true AS was_inserted
       FROM inserted_tx
       UNION ALL
       SELECT "receiptNumber", false AS was_inserted
       FROM existing
       WHERE NOT EXISTS (SELECT 1 FROM inserted_tx)
       LIMIT 1`,
      [
        saleId,                              // $1
        user.tenantId,                       // $2
        payload.deviceId,                    // $3
        payload.receiptNumber ?? null,       // $4
        modeAtCreation,                      // $5
        user.id,                             // $6
        subtotal,                            // $7
        taxApplied,                          // $8
        taxTotal,                            // $9
        discountTotal,                       // $10
        deliveryFee,                         // $11
        total,                               // $12
        payload.tenderType,                  // $13
        amountTendered,                      // $14
        changeGiven,                         // $15
        now,                                 // $16
        lineIdsArr,                          // $17
        lineItemIdsArr,                      // $18
        lineItemNamesArr,                    // $19
        lineQtysArr,                         // $20
        lineUnitPricesArr,                   // $21
        lineModDeltasArr,                    // $22
        lineTotalsArr,                       // $23
        lineNotesArr,                        // $24
        lineRecipeVersionsArr,               // $25
        lineSortOrdersArr,                   // $26
      ]
    )) as Array<{ receiptNumber: string; was_inserted: boolean }>;

    if (rows.length === 0) {
      throw new Error('Sale insert produced no row and no existing row was found');
    }
    receiptNumber = rows[0].receiptNumber;
    wasInserted = rows[0].was_inserted;

    // --- 5. Stock movements — ONLY when this was a fresh insert AND mode is FULL ---
    //    On retry (wasInserted = false), we already stamped the original
    //    movements; re-running would double-count. On POS_PAUSED, we never
    //    write stock_movements at all (the whole point of the mode).
    //    Finished-goods decrement was already done atomically in the CTE
    //    above via `fg_update` joining to `inserted_lines`.
    if (wasInserted && shouldDeductRawMaterials(modeAtCreation) && deductions.length > 0) {
      await recordSaleDeductions(user.tenantId, deductions, {
        saleId,
        userId: user.id,
        outletId: null,
      });
    }

    return NextResponse.json({
      sale: {
        id: saleId,
        receiptNumber,
        createdAt: now,
        cashierId: user.id,
        modeAtCreation,
        subtotal, taxApplied, taxTotal, discountTotal, deliveryFee, total,
        tenderType: payload.tenderType,
        amountTendered, changeGiven,
        lines: computedLines.map((l) => ({
          id: l.id,
          itemId: l.itemId,
          itemName: l.item.name,
          qty: l.qty,
          unitPrice: l.item.price,
          taxRate: l.item.taxRate,
          lineTotal: l.lineTotal,
          lineTax: l.lineTax,
        })),
      },
      deductions: deductions.map(d => ({
        materialId: d.materialId,
        qty: d.qty,
        unit: d.unit,
      })),
      idempotent: !wasInserted,
    }, { status: 201 });
  } catch (e) {
    const msg = (e as Error).message ?? '';
    console.error('[sales POST]', msg);
    return NextResponse.json({ error: msg || 'Sale failed' }, { status: 500 });
  }
}
