/**
 * Stock Ledger — single write path for every quantity change.
 *
 * Hard rule: NO code outside this file is allowed to write to
 * `stock_batches` or `stock_movements`. Every sale, bake, receive, waste,
 * count-adjust goes through a function here. This is what makes the
 * inventory page trustworthy.
 *
 * Architecture notes:
 *   - Append-only `stock_movements` is the source of truth (audit log)
 *   - `stock_batches.remainingQty` is a derived cache of SUM(movements)
 *     per batch, kept in sync by this file
 *   - Current on-hand for a material = SUM(remainingQty) over active batches
 *   - Movement IDs are ULIDs — time-sortable, generatable offline, safe to
 *     merge from multiple devices in Sprint 6
 *   - Atomic compound writes use PostgreSQL CTEs (single round-trip over
 *     Neon HTTP), not multi-statement transactions. CTE semantics in PG
 *     guarantee all-or-nothing within the statement.
 *   - All qty math in the ledger happens in the material's baseUnit. Unit
 *     conversion is the caller's job (lib/stock/convert.ts, Step 4).
 */

import { sql } from '@/lib/neonHttp';
import type { Unit } from '@/lib/repos/materials';

// ---------------------------------------------------------------------------
// Types (mirror Prisma schema — keep in sync)
// ---------------------------------------------------------------------------

export type MovementKind = 'IN' | 'OUT' | 'ADJUSTMENT';

export type MovementReason =
  | 'PURCHASE'
  | 'RETURN_TO_SUPPLIER'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'SALE'
  | 'WASTE'
  | 'COUNT_CORRECTION'
  | 'OPENING_BALANCE'
  | 'PRODUCTION_CONSUME'
  | 'PRODUCTION_OUTPUT';

export interface StockBatch {
  id: string;
  tenantId: string;
  outletId: string | null;
  materialId: string;
  supplierId: string | null;
  receivedAt: string;
  expiryDate: string | null;
  unitCost: number;
  receivedQty: number;
  remainingQty: number;
  invoiceRef: string | null;
}

export interface StockMovement {
  id: string;
  tenantId: string;
  outletId: string | null;
  materialId: string;
  batchId: string | null;
  kind: MovementKind;
  reason: MovementReason;
  qty: number;              // signed: positive IN, negative OUT
  unit: Unit;
  saleId: string | null;
  saleLineId: string | null;
  wasteId: string | null;
  userId: string | null;
  createdAt: string;
  note: string | null;
}

// ---------------------------------------------------------------------------
// ULID — 26-char Crockford Base32, time-sortable, safe offline.
//   [0-9] + Crockford(excl I,L,O,U) ensures lexicographic = chronological.
// ---------------------------------------------------------------------------

const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function ulidTime(ms: number): string {
  let s = '';
  for (let i = 9; i >= 0; i--) {
    s += ULID_ALPHABET[Math.floor(ms / 32 ** i) % 32];
  }
  return s;
}

function ulidRandom(): string {
  let s = '';
  for (let i = 0; i < 16; i++) {
    s += ULID_ALPHABET[Math.floor(Math.random() * 32)];
  }
  return s;
}

export function toUlid(): string {
  return ulidTime(Date.now()) + ulidRandom();
}

// Reusable cuid helper (mirrors the one in repos/materials.ts — duplicated
// here rather than imported to keep the ledger self-contained).
function toCuid(): string {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
  let s = 'c';
  for (let i = 0; i < 24; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface ReceiveStockInput {
  materialId: string;
  qty: number;                  // in material.baseUnit
  unit: Unit;                   // must equal material.baseUnit (validated by caller)
  unitCost: number;             // MMK per unit
  receivedAt?: Date;            // defaults to now
  expiryDate?: Date | null;
  supplierId?: string | null;
  invoiceRef?: string | null;
  outletId?: string | null;
  userId?: string | null;
  note?: string | null;
}

export interface ReceiveStockResult {
  batchId: string;
  movementId: string;
}

// ---------------------------------------------------------------------------
// Receive — single atomic write: batch + movement + lastUnitCost update
// ---------------------------------------------------------------------------

export async function receiveStock(
  tenantId: string,
  input: ReceiveStockInput
): Promise<ReceiveStockResult> {
  if (input.qty <= 0) throw new Error('Receive quantity must be positive');
  if (input.unitCost < 0) throw new Error('Unit cost cannot be negative');

  const batchId = toCuid();
  const movementId = toUlid();
  const receivedAt = (input.receivedAt ?? new Date()).toISOString();

  // CTEs run atomically in PostgreSQL — all three writes or none.
  const rows = (await sql(
    `WITH inserted_batch AS (
       INSERT INTO stock_batches (
         id, "tenantId", "outletId", "materialId", "supplierId",
         "receivedAt", "expiryDate", "unitCost", "receivedQty", "remainingQty", "invoiceRef"
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6::timestamp, $7::timestamp, $8, $9, $9, $10
       )
       RETURNING id, "materialId"
     ),
     inserted_movement AS (
       INSERT INTO stock_movements (
         id, "tenantId", "outletId", "materialId", "batchId",
         kind, reason, qty, unit, "userId", "createdAt", note
       )
       SELECT $11, $2, $3, "materialId", id,
              'IN', 'PURCHASE', $9, $12, $13, NOW(), $14
       FROM inserted_batch
       RETURNING id
     ),
     updated_material AS (
       UPDATE raw_materials
       SET "lastUnitCost" = $8, "updatedAt" = NOW()
       WHERE id = $4 AND "tenantId" = $2
       RETURNING id
     )
     SELECT
       (SELECT id FROM inserted_batch)    AS batch_id,
       (SELECT id FROM inserted_movement) AS movement_id`,
    [
      batchId,               // $1
      tenantId,              // $2
      input.outletId ?? null,// $3
      input.materialId,      // $4
      input.supplierId ?? null, // $5
      receivedAt,            // $6
      input.expiryDate ? input.expiryDate.toISOString() : null, // $7
      input.unitCost,        // $8
      input.qty,             // $9
      input.invoiceRef ?? null, // $10
      movementId,            // $11
      input.unit,            // $12
      input.userId ?? null,  // $13
      input.note ?? null,    // $14
    ]
  )) as Array<{ batch_id: string; movement_id: string }>;

  const row = rows[0];
  if (!row?.batch_id || !row?.movement_id) {
    throw new Error('Receive failed — no rows returned');
  }
  return { batchId: row.batch_id, movementId: row.movement_id };
}

// ---------------------------------------------------------------------------
// FIFO deduct — consume qty from oldest batches, write OUT movements
//
// Called by sale, waste, and production-consume flows. The caller supplies
// the reason so the audit log distinguishes "deducted because we sold a
// Latte" from "deducted because we threw away spoiled milk".
//
// Strategy:
//   Iterative per material — for each sold material:
//     1. Read oldest batch with remainingQty > 0
//     2. Take as much as needed from it (min of need vs remaining)
//     3. UPDATE batch + INSERT movement atomically via CTE
//     4. Repeat until need is met OR no more batches (throws)
//
// Performance: typically 1-2 queries per material (most sales consume from
// just the current open batch). Acceptable over HTTP for the <10 req/sec
// this shop will ever see.
// ---------------------------------------------------------------------------

export interface DeductSpec {
  materialId: string;
  qty: number;      // positive, in material.baseUnit
  unit: Unit;       // must equal material.baseUnit (caller converts via lib/stock/convert)
  /** Human name — surfaces in error messages instead of the cryptic CUID.
   *  Optional for backwards compat; callers should populate when available. */
  materialName?: string;
}

export interface DeductionContext {
  reason: MovementReason;              // SALE | WASTE | TRANSFER_OUT | PRODUCTION_CONSUME (not yet modelled — use RETURN_TO_SUPPLIER for now? no — we'll add if needed)
  saleId?: string | null;
  saleLineId?: string | null;
  wasteId?: string | null;
  userId?: string | null;
  outletId?: string | null;
  note?: string | null;
}

export interface DeductResult {
  materialId: string;
  totalDeducted: number;
  movementIds: string[];
  batchIdsConsumed: string[];
}

/**
 * Deduct one material's quantity by pulling from batches in FIFO order.
 *
 * Throws if there isn't enough stock — the caller should either reject the
 * sale or allow negative stock (we reject by default for bakery safety).
 */
async function deductOneMaterial(
  tenantId: string,
  spec: DeductSpec,
  ctx: DeductionContext
): Promise<DeductResult> {
  let remaining = spec.qty;
  const movementIds: string[] = [];
  const batchIdsConsumed: string[] = [];

  // Loop: pull from oldest active batch until need is satisfied.
  // We select and deduct in one CTE per iteration — atomic per iteration,
  // but multiple iterations can race with concurrent sales. For one-POS
  // shops (Pae Ka Yauk) this is fine; multi-POS needs advisory locks
  // (Sprint 6 sync work).
  let safety = 50;                      // cap in case of pathological data
  while (remaining > 0 && safety-- > 0) {
    const movementId = toUlid();
    const rows = (await sql(
      `WITH oldest AS (
         SELECT id, "remainingQty"::float8 AS qty_left
         FROM stock_batches
         WHERE "tenantId" = $1 AND "materialId" = $2 AND "remainingQty" > 0
         ORDER BY "receivedAt" ASC, id ASC
         LIMIT 1
       ),
       take_amount AS (
         SELECT id, LEAST(qty_left, $3::float8) AS take FROM oldest
       ),
       updated_batch AS (
         UPDATE stock_batches
         SET "remainingQty" = "remainingQty" - (SELECT take FROM take_amount)
         WHERE id = (SELECT id FROM take_amount)
         RETURNING id, "remainingQty"::float8 AS left_after
       ),
       new_movement AS (
         INSERT INTO stock_movements (
           id, "tenantId", "outletId", "materialId", "batchId",
           kind, reason, qty, unit,
           "saleId", "saleLineId", "wasteId", "userId",
           "createdAt", note
         )
         SELECT $4, $1, $5, $2, (SELECT id FROM take_amount),
                'OUT', $6, -(SELECT take FROM take_amount), $7,
                $8, $9, $10, $11,
                NOW(), $12
         WHERE EXISTS (SELECT 1 FROM take_amount)
         RETURNING id
       )
       SELECT
         (SELECT id FROM take_amount)    AS batch_id,
         (SELECT take FROM take_amount)  AS taken,
         (SELECT id FROM new_movement)   AS movement_id`,
      [
        tenantId,                 // $1
        spec.materialId,          // $2
        remaining,                // $3
        movementId,               // $4
        ctx.outletId ?? null,     // $5
        ctx.reason,               // $6
        spec.unit,                // $7
        ctx.saleId ?? null,       // $8
        ctx.saleLineId ?? null,   // $9
        ctx.wasteId ?? null,      // $10
        ctx.userId ?? null,       // $11
        ctx.note ?? null,         // $12
      ]
    )) as Array<{ batch_id: string | null; taken: number | null; movement_id: string | null }>;

    const row = rows[0];
    if (!row?.batch_id || row.taken == null || row.taken <= 0) {
      throw new Error(
        `Insufficient stock for ${spec.materialName ?? spec.materialId}: needed ${spec.qty} ${spec.unit}, short by ${remaining}`
      );
    }
    remaining -= Number(row.taken);
    movementIds.push(row.movement_id!);
    batchIdsConsumed.push(row.batch_id);
  }
  if (remaining > 0.0001) {
    throw new Error(
      `Deduction loop hit safety cap for material ${spec.materialName ?? spec.materialId} — remaining ${remaining}`
    );
  }
  return { materialId: spec.materialId, totalDeducted: spec.qty, movementIds, batchIdsConsumed };
}

/**
 * Apply a list of deductions (from the BOM engine) as a single sale's worth
 * of stock consumption.
 *
 * Not transactional across materials — if material #3 fails mid-sale, the
 * first two are already deducted. For Pae Ka Yauk's scale this is OK; the
 * caller validates stock availability before calling in happy path.
 */
export async function recordSaleDeductions(
  tenantId: string,
  deductions: DeductSpec[],
  ctx: Omit<DeductionContext, 'reason'> & { saleId: string }
): Promise<DeductResult[]> {
  const results: DeductResult[] = [];
  for (const d of deductions) {
    results.push(
      await deductOneMaterial(tenantId, d, { ...ctx, reason: 'SALE' })
    );
  }
  return results;
}

/**
 * Apply a list of deductions (from the BOM engine) as a single bake's worth
 * of stock consumption. Mirrors recordSaleDeductions but stamps the
 * PRODUCTION_CONSUME reason and back-fills productionBatchId on each
 * resulting movement so reports can drill from a bake row to the batches it
 * consumed.
 *
 * Used by /api/production after the route has already inserted the
 * production_batches row + credited finishedGoodsOnHand atomically. Gated
 * upstream on (wasInserted && mode === 'FULL') to keep the ledger write
 * idempotent on retry and silent in PAUSED mode.
 *
 * Same per-material atomicity caveat as recordSaleDeductions: if material #3
 * fails mid-bake, the first two are already deducted. Caller pre-validates.
 */
export async function recordProductionDeductions(
  tenantId: string,
  deductions: DeductSpec[],
  ctx: Omit<DeductionContext, 'reason'> & { productionBatchId: string }
): Promise<DeductResult[]> {
  const results: DeductResult[] = [];
  for (const d of deductions) {
    const r = await deductOneMaterial(tenantId, d, {
      ...ctx,
      reason: 'PRODUCTION_CONSUME',
    });
    // Back-fill productionBatchId on each movement so the audit log lets a
    // production row show "what batches did this bake consume".
    for (const mid of r.movementIds) {
      await sql(
        `UPDATE stock_movements SET "productionBatchId" = $1 WHERE id = $2`,
        [ctx.productionBatchId, mid]
      );
    }
    results.push(r);
  }
  return results;
}

/**
 * Reverse the raw-material deductions from a previously-completed sale.
 *
 * For every `stock_movements` row with reason='SALE' and saleId=$saleId,
 * we insert a compensating `kind='IN'` row with reason='SALE_VOID' against
 * the SAME batch and bump that batch's `remainingQty` back up. The
 * batch-id link is what makes this a "true reversal" — the qty goes back
 * to the exact lot it came from, not a synthetic one.
 *
 * Idempotency: if any 'SALE_VOID' row already exists for this saleId we
 * return early. The void route gates this call on the status flip so a
 * retry shouldn't reach here, but the second guard makes the helper safe
 * to call directly from a CLI repair script too.
 *
 * Only reverses raw-material movements. BATCH finished-goods restoration
 * is handled by the void route in the same atomic CTE that flips status.
 */
export async function reverseSaleMaterialMovements(
  tenantId: string,
  saleId: string,
  userId?: string | null,
): Promise<{ reversedCount: number }> {
  // Idempotency guard.
  const existing = (await sql(
    `SELECT 1 FROM stock_movements
       WHERE "tenantId" = $1 AND "saleId" = $2 AND reason = 'SALE_VOID'
       LIMIT 1`,
    [tenantId, saleId]
  )) as Array<{ '?column?': number }>;
  if (existing.length > 0) {
    return { reversedCount: 0 };
  }

  // Find every SALE-deduction movement for this transaction.
  const originals = (await sql(
    `SELECT id, "outletId", "materialId", "batchId",
            qty::float8 AS qty, unit, "saleLineId"
       FROM stock_movements
      WHERE "tenantId" = $1 AND "saleId" = $2 AND reason = 'SALE' AND kind = 'OUT'`,
    [tenantId, saleId]
  )) as Array<{
    id: string; outletId: string | null; materialId: string;
    batchId: string | null; qty: number; unit: string; saleLineId: string | null;
  }>;

  if (originals.length === 0) return { reversedCount: 0 };

  // For each original, insert a positive compensating movement and bump
  // the source batch's remainingQty. Done one at a time over HTTP — no
  // multi-statement transactions on this driver, but the
  // movement+batch UPDATE pair sits in one CTE per material so each
  // reversal is at least atomic at its own step.
  let reversedCount = 0;
  for (const m of originals) {
    const newId = toUlid();
    await sql(
      `WITH new_movement AS (
         INSERT INTO stock_movements (
           id, "tenantId", "outletId", "materialId", "batchId",
           kind, reason, qty, unit, "saleId", "saleLineId",
           "userId", "createdAt", note
         ) VALUES (
           $1, $2, $3, $4, $5,
           'IN', 'SALE_VOID', $6, $7::"Unit", $8, $9,
           $10, NOW(), 'sale void reversal'
         )
         RETURNING id, "batchId", qty
       )
       UPDATE stock_batches sb
          SET "remainingQty" = sb."remainingQty" + nm.qty
         FROM new_movement nm
        WHERE sb.id = nm."batchId"`,
      [newId, tenantId, m.outletId, m.materialId, m.batchId,
       m.qty, m.unit, saleId, m.saleLineId, userId ?? null],
    );
    reversedCount++;
  }
  return { reversedCount };
}

/**
 * Record a raw-material write-off (spoilage, breakage, staff meal, etc).
 *
 * FIFO deduction shape — same path a sale takes, just stamped with
 * reason='WASTE' and a `wasteId` link so the audit log can drill from a
 * waste_entries row to the batches it consumed.
 *
 * Caller responsibility: insert the waste_entries row first (idempotent via
 * ON CONFLICT (id) DO NOTHING), then gate this call on wasInserted, so a
 * retry never double-deducts.
 *
 * Throws if the material doesn't have enough on-hand for the write-off —
 * uses the same friendly material-name error sales raise for BOM failures.
 */
export async function recordWasteDeduction(
  tenantId: string,
  spec: DeductSpec,
  ctx: { wasteId: string; userId?: string | null; note?: string | null; outletId?: string | null },
): Promise<DeductResult> {
  return deductOneMaterial(tenantId, spec, {
    reason: 'WASTE',
    wasteId: ctx.wasteId,
    userId: ctx.userId ?? null,
    note: ctx.note ?? null,
    outletId: ctx.outletId ?? null,
  });
}

// ---------------------------------------------------------------------------
// Finished-goods deduction — for sales of BATCH-produced items.
// Decrements sellable_items.finishedGoodsOnHand atomically, rejects if
// there isn't enough (we default to no-negative-stock).
// ---------------------------------------------------------------------------

export async function deductFinishedGoods(
  tenantId: string,
  itemId: string,
  qty: number
): Promise<{ newOnHand: number }> {
  if (qty <= 0) throw new Error('Finished-goods deduction qty must be positive');

  const rows = (await sql(
    `UPDATE sellable_items
     SET "finishedGoodsOnHand" = "finishedGoodsOnHand" - $1, "updatedAt" = NOW()
     WHERE id = $2 AND "tenantId" = $3
       AND "finishedGoodsOnHand" >= $1
     RETURNING "finishedGoodsOnHand"::float8 AS on_hand`,
    [qty, itemId, tenantId]
  )) as Array<{ on_hand: number }>;

  if (rows.length === 0) {
    throw new Error(`Insufficient finished goods for item ${itemId}: needed ${qty}`);
  }
  return { newOnHand: Number(rows[0].on_hand) };
}

// ---------------------------------------------------------------------------
// Read helpers (no writes — safe to call anywhere)
// ---------------------------------------------------------------------------

/** Current on-hand for one material = SUM(active batches). Returns 0 if none. */
export async function getOnHand(
  tenantId: string,
  materialId: string
): Promise<number> {
  const rows = (await sql(
    `SELECT COALESCE(SUM("remainingQty"), 0)::float8 AS on_hand
     FROM stock_batches
     WHERE "tenantId" = $1 AND "materialId" = $2 AND "remainingQty" > 0`,
    [tenantId, materialId]
  )) as Array<{ on_hand: number }>;
  return Number(rows[0]?.on_hand ?? 0);
}

/** Bulk on-hand — one query for many materials (used by the list page). */
export async function getOnHandMap(
  tenantId: string,
  materialIds: string[]
): Promise<Record<string, number>> {
  if (materialIds.length === 0) return {};
  const rows = (await sql(
    `SELECT "materialId",
            COALESCE(SUM("remainingQty"), 0)::float8 AS on_hand
     FROM stock_batches
     WHERE "tenantId" = $1 AND "materialId" = ANY($2::text[])
     GROUP BY "materialId"`,
    [tenantId, materialIds]
  )) as Array<{ materialId: string; on_hand: number }>;

  const map: Record<string, number> = {};
  for (const id of materialIds) map[id] = 0;
  for (const r of rows) map[r.materialId] = Number(r.on_hand);
  return map;
}

/** Earliest-expiring non-empty batch (null if no batches track expiry). */
export async function getNextExpiringBatch(
  tenantId: string,
  materialId: string
): Promise<StockBatch | null> {
  const rows = (await sql(
    `SELECT id, "tenantId", "outletId", "materialId", "supplierId",
            "receivedAt"::text  AS "receivedAt",
            "expiryDate"::text  AS "expiryDate",
            "unitCost"::float8  AS "unitCost",
            "receivedQty"::float8  AS "receivedQty",
            "remainingQty"::float8 AS "remainingQty",
            "invoiceRef"
     FROM stock_batches
     WHERE "tenantId" = $1 AND "materialId" = $2
       AND "remainingQty" > 0 AND "expiryDate" IS NOT NULL
     ORDER BY "expiryDate" ASC
     LIMIT 1`,
    [tenantId, materialId]
  )) as StockBatch[];
  return rows[0] ?? null;
}

/** Active (non-empty) batches in FIFO order. For the Batches tab. */
export async function listActiveBatches(
  tenantId: string,
  materialId: string
): Promise<StockBatch[]> {
  const rows = (await sql(
    `SELECT id, "tenantId", "outletId", "materialId", "supplierId",
            "receivedAt"::text  AS "receivedAt",
            "expiryDate"::text  AS "expiryDate",
            "unitCost"::float8  AS "unitCost",
            "receivedQty"::float8  AS "receivedQty",
            "remainingQty"::float8 AS "remainingQty",
            "invoiceRef"
     FROM stock_batches
     WHERE "tenantId" = $1 AND "materialId" = $2 AND "remainingQty" > 0
     ORDER BY "receivedAt" ASC`,
    [tenantId, materialId]
  )) as StockBatch[];
  return rows;
}

/** Recent movements for one material. Used by the Movements tab. */
export async function listMovements(
  tenantId: string,
  materialId: string,
  opts: { limit?: number; offset?: number } = {}
): Promise<StockMovement[]> {
  const { limit = 100, offset = 0 } = opts;
  const rows = (await sql(
    `SELECT id, "tenantId", "outletId", "materialId", "batchId",
            kind, reason,
            qty::float8 AS qty,
            unit,
            "saleId", "saleLineId", "wasteId", "userId",
            "createdAt"::text AS "createdAt",
            note
     FROM stock_movements
     WHERE "tenantId" = $1 AND "materialId" = $2
     ORDER BY "createdAt" DESC, id DESC
     LIMIT $3 OFFSET $4`,
    [tenantId, materialId, limit, offset]
  )) as StockMovement[];
  return rows;
}

// ---------------------------------------------------------------------------
// Stock status — derived from on-hand vs par level + expiry
// ---------------------------------------------------------------------------

export type StockStatus = 'OK' | 'LOW' | 'OUT' | 'EXPIRING' | 'EXPIRED';

export interface OnHandSnapshot {
  onHand: number;
  status: StockStatus;
  nearestExpiry: string | null;  // ISO date of soonest-expiring batch
}

/**
 * Bulk snapshot for the inventory list: on-hand + status + expiry signal
 * for every material in one query set.
 *
 * Status rules (first match wins):
 *   EXPIRED    — any batch with expiryDate <= today still has remainingQty > 0
 *   OUT        — onHand = 0
 *   LOW        — parLevel set AND onHand < parLevel
 *   EXPIRING   — nearest expiry within 7 days
 *   OK         — otherwise
 */
export async function getOnHandSnapshot(
  tenantId: string,
  materialIds: string[]
): Promise<Record<string, OnHandSnapshot>> {
  if (materialIds.length === 0) return {};

  const onHandMap = await getOnHandMap(tenantId, materialIds);

  // Expiry snapshot — for each material, find min expiryDate of active batches
  // and whether any expired ones still have qty remaining.
  const rows = (await sql(
    `SELECT b."materialId",
            MIN(b."expiryDate")::text AS nearest_expiry,
            BOOL_OR(b."expiryDate" IS NOT NULL AND b."expiryDate" <= NOW()) AS has_expired,
            m."parLevel"::float8 AS par_level
     FROM stock_batches b
     JOIN raw_materials m ON m.id = b."materialId"
     WHERE b."tenantId" = $1 AND b."materialId" = ANY($2::text[])
       AND b."remainingQty" > 0
     GROUP BY b."materialId", m."parLevel"`,
    [tenantId, materialIds]
  )) as Array<{
    materialId: string;
    nearest_expiry: string | null;
    has_expired: boolean;
    par_level: number | null;
  }>;

  // Par level for materials with no active batches (need separate lookup)
  const noBatchIds = materialIds.filter(
    id => !rows.find(r => r.materialId === id)
  );
  const parMap: Record<string, number | null> = {};
  for (const r of rows) parMap[r.materialId] = r.par_level;
  if (noBatchIds.length > 0) {
    const parRows = (await sql(
      `SELECT id, "parLevel"::float8 AS par_level
       FROM raw_materials
       WHERE "tenantId" = $1 AND id = ANY($2::text[])`,
      [tenantId, noBatchIds]
    )) as Array<{ id: string; par_level: number | null }>;
    for (const r of parRows) parMap[r.id] = r.par_level;
  }

  const sevenDaysFromNow = new Date();
  sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

  const out: Record<string, OnHandSnapshot> = {};
  for (const id of materialIds) {
    const onHand = onHandMap[id] ?? 0;
    const row = rows.find(r => r.materialId === id);
    const nearestExpiry = row?.nearest_expiry ?? null;
    const hasExpired = row?.has_expired ?? false;
    const parLevel = parMap[id];

    let status: StockStatus;
    if (hasExpired) {
      status = 'EXPIRED';
    } else if (onHand === 0) {
      status = 'OUT';
    } else if (parLevel != null && onHand < parLevel) {
      status = 'LOW';
    } else if (nearestExpiry && new Date(nearestExpiry) <= sevenDaysFromNow) {
      status = 'EXPIRING';
    } else {
      status = 'OK';
    }

    out[id] = { onHand, status, nearestExpiry };
  }
  return out;
}
