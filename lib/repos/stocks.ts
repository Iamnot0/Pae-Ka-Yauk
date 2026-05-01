/**
 * Stocks repo — drives the /stocks page.
 *
 * "Stocks" = sellable_items, viewed through the lens of finished-goods
 * inventory. Each row pulls together:
 *   - on-hand count from sellable_items.finishedGoodsOnHand
 *   - DMG / FOC running totals from stock_adjustments, windowed by period
 *   - price for display
 *
 * The Expire column shows days-until-expiry computed from
 * `sellable_items.expiryDate` (date column, nullable). We expose the raw
 * day-count and the underlying ISO date so the component can render
 * "1 Day" / "3 Days" / "Expired" with i18n, instead of formatting the
 * string here.
 */

import { sql } from '@/lib/neonHttp';
import { convert, sameDimension } from '@/lib/stock/convert';
import type { Unit } from '@/lib/repos/materials';
import type { ItemCategory } from '@/lib/repos/items';

export type StockPeriod = 'today' | 'week' | 'all';

export interface StockRow {
  id: string;
  sku: string | null;           // barcode, scannable at POS once that flow ships
  name: string;
  nameLocal: string | null;
  category: ItemCategory;       // BAKERY_BREAD / COFFEE_HOT / TEA / etc.
  productionMode: 'DIRECT' | 'BATCH';
  price: number;
  onHand: number | null;       // null for DIRECT items (made-to-order, no shelf count)
  // Production-batch aggregates over the current period window; null for DIRECT.
  // Invariant: bakedQty + receivedQty === stockInQty.
  bakedQty: number | null;      // sum of actualYield where source='BAKED' (in-house bakes)
  receivedQty: number | null;   // sum of actualYield where source='RECEIVED' (paused-mode finished-goods receipts)
  stockInQty: number | null;    // total sum of actualYield (BAKED + RECEIVED)
  dmg: number;                  // sum of qty in stock_adjustments where category=DAMAGED, in window
  foc: number;                  // sum of qty where category=FOC, in window
  /**
   * Days until per-item expiry, computed live from sellable_items.expiryDate
   * vs. today's calendar date in tenant TZ. Null = no date set. 0 = today.
   * Negative = already past expiry (component renders "Expired").
   */
  daysUntilExpiry: number | null;
  /** ISO yyyy-mm-dd of the configured expiry date — surfaced for tooltip/debug. */
  expiryDate: string | null;
  costPerUnit: number | null;   // production cost per yield unit; null if no recipe or any material lacks lastUnitCost
  manualCost: number | null;    // owner-entered cost (used in POS_PAUSED, fallback in FULL)
  unit: Unit | null;            // recipe yieldUnit (PCS / BOX / CUP / PACK / BOTTLE); null if no active recipe
  active: boolean;
}

/** Resolve the period to a SQL `>=` cutoff timestamp string. */
function cutoffFor(period: StockPeriod): string | null {
  if (period === 'all') return null;
  const now = new Date();
  if (period === 'today') {
    now.setHours(0, 0, 0, 0);
  } else { // 'week'
    now.setDate(now.getDate() - 6); // last 7 days incl. today
    now.setHours(0, 0, 0, 0);
  }
  return now.toISOString();
}

/**
 * Fetch all active sellable items joined with windowed DMG/FOC counts.
 * One round-trip; aggregates done in SQL so we don't N+1 the DB.
 */
export async function getStocks(
  tenantId: string,
  period: StockPeriod = 'today',
): Promise<StockRow[]> {
  const cutoff = cutoffFor(period);

  const rows = await sql(
    `SELECT
       i.id,
       i.sku,
       i.name,
       i."nameLocal",
       i.category::text AS category,
       i."productionMode"::text AS "productionMode",
       i.price::float8 AS price,
       CASE WHEN i."productionMode" = 'BATCH'
            THEN i."finishedGoodsOnHand"::float8
            ELSE NULL
       END AS "onHand",
       CASE WHEN i."productionMode" = 'BATCH'
            THEN COALESCE(p."bakedQty", 0)::float8
            ELSE NULL
       END AS "bakedQty",
       CASE WHEN i."productionMode" = 'BATCH'
            THEN COALESCE(p."receivedQty", 0)::float8
            ELSE NULL
       END AS "receivedQty",
       CASE WHEN i."productionMode" = 'BATCH'
            THEN COALESCE(p."stockInQty", 0)::float8
            ELSE NULL
       END AS "stockInQty",
       COALESCE(d.qty, 0)::int AS dmg,
       COALESCE(f.qty, 0)::int AS foc,
       i."manualCost"::float8 AS "manualCost",
       i.unit AS "directUnit",
       -- Soonest non-past expiry across this item's recent batches. Falls
       -- back to the per-item expiryDate if no batch has stamped one yet
       -- (e.g., shop just enabled the feature, no fresh bake recorded).
       COALESCE(
         (SELECT MIN(pb."expiryDate")::text
            FROM production_batches pb
           WHERE pb."tenantId" = i."tenantId"
             AND pb."itemId" = i.id
             AND pb."expiryDate" IS NOT NULL
             AND pb."expiryDate" >= (NOW() AT TIME ZONE 'Asia/Yangon')::date),
         i."expiryDate"::text
       ) AS "expiryDate",
       i.active
     FROM sellable_items i
     LEFT JOIN (
       SELECT "itemId", SUM(qty) AS qty
       FROM stock_adjustments
       WHERE "tenantId" = $1
         AND category = 'DAMAGED'
         ${cutoff ? `AND "createdAt" >= $2::timestamptz` : ''}
       GROUP BY "itemId"
     ) d ON d."itemId" = i.id
     LEFT JOIN (
       SELECT "itemId", SUM(qty) AS qty
       FROM stock_adjustments
       WHERE "tenantId" = $1
         AND category = 'FOC'
         ${cutoff ? `AND "createdAt" >= $2::timestamptz` : ''}
       GROUP BY "itemId"
     ) f ON f."itemId" = i.id
     LEFT JOIN (
       SELECT "itemId",
              SUM(CASE WHEN source = 'BAKED'    THEN "actualYield" ELSE 0 END) AS "bakedQty",
              SUM(CASE WHEN source = 'RECEIVED' THEN "actualYield" ELSE 0 END) AS "receivedQty",
              SUM("actualYield")                                               AS "stockInQty"
       FROM production_batches
       WHERE "tenantId" = $1
         ${cutoff ? `AND "createdAt" >= $2::timestamptz` : ''}
       GROUP BY "itemId"
     ) p ON p."itemId" = i.id
     WHERE i."tenantId" = $1
       AND i."deletedAt" IS NULL
     ORDER BY i.name ASC`,
    cutoff ? [tenantId, cutoff] : [tenantId],
  ) as Array<{
    id: string;
    sku: string | null;
    name: string;
    nameLocal: string | null;
    category: ItemCategory;
    productionMode: 'DIRECT' | 'BATCH';
    price: number;
    onHand: number | null;
    bakedQty: number | null;
    receivedQty: number | null;
    stockInQty: number | null;
    dmg: number;
    foc: number;
    manualCost: number | null;
    directUnit: string | null;
    expiryDate: string | null;
    active: boolean;
  }>;

  // ── Cost per yield-unit + yield unit ─────────────────────────
  // Mirrors the recipe editor's CostPanel math, server-side: for each item's
  // active recipe, sum (ingredient.qty in baseUnit × material.lastUnitCost),
  // divide by recipe.yield. Returns null if no recipe OR any material lacks
  // lastUnitCost (we don't lie with a partial number). Also surfaces the
  // recipe's `yieldUnit` so the table can show "20 PCS" not just "20".
  const recipeMeta = await computeRecipeCosts(tenantId);

  // Today in Asia/Yangon as a calendar day (yyyy-mm-dd). Used to compute
  // days-until-expiry without timezone surprises: both today and the
  // stored expiryDate are calendar dates, never instants.
  const today = todayInTenantTz('Asia/Yangon');

  return rows.map((r) => ({
    ...r,
    daysUntilExpiry: r.expiryDate ? diffDays(r.expiryDate, today) : null,
    costPerUnit: recipeMeta[r.id]?.cost ?? null,
    // Unit precedence: explicit sellable_items.unit (set by xlsx import / Edit form)
    // wins; recipe yieldUnit is the fallback for items that have a recipe but
    // no explicit unit. This lets POS-PAUSED-only tenants display units without
    // needing a recipe defined.
    unit: (r.directUnit as Unit | null) ?? recipeMeta[r.id]?.unit ?? null,
  }));
}

/**
 * Calendar day in the tenant's timezone, as `yyyy-mm-dd`. We use
 * `Intl.DateTimeFormat` with `en-CA` locale because en-CA renders
 * dates as ISO `yyyy-mm-dd` natively — saves a regex/parse pass and
 * stays correct regardless of server locale.
 */
function todayInTenantTz(tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());
}

/** Days from `from` (yyyy-mm-dd) to `to` (yyyy-mm-dd). Negative = past. */
function diffDays(targetIso: string, todayIso: string): number {
  const t = Date.UTC(+targetIso.slice(0, 4), +targetIso.slice(5, 7) - 1, +targetIso.slice(8, 10));
  const n = Date.UTC(+todayIso.slice(0, 4), +todayIso.slice(5, 7) - 1, +todayIso.slice(8, 10));
  return Math.round((t - n) / 86_400_000);
}

/**
 * Per-item production cost (per yield-unit). Two queries: active recipes
 * with ingredients, and the materials they reference. We compute in JS so
 * we can use the existing unit-conversion helper instead of replicating it
 * in SQL — recipes can express ingredient qty in `KG` while the material
 * stores cost per `G`, etc.
 */
export interface RecipeMeta { cost: number | null; unit: Unit | null; }

export async function computeRecipeCosts(tenantId: string): Promise<Record<string, RecipeMeta>> {
  const recipeRows = (await sql(
    `SELECT r.id, r."itemId", r.yield::float8 AS yield, r."yieldUnit",
            ri."materialId", ri.quantity::float8 AS quantity, ri.unit
       FROM recipes r
       JOIN recipe_ingredients ri ON ri."recipeId" = r.id
      WHERE r."tenantId" = $1 AND r."activeTo" IS NULL`,
    [tenantId],
  )) as Array<{
    id: string;
    itemId: string;
    yield: number;
    yieldUnit: Unit;
    materialId: string;
    quantity: number;
    unit: Unit;
  }>;

  if (recipeRows.length === 0) return {};

  const matIds = [...new Set(recipeRows.map((r) => r.materialId))];
  const matRows = (await sql(
    `SELECT id, "baseUnit", "lastUnitCost"::float8 AS "lastUnitCost"
       FROM raw_materials
      WHERE "tenantId" = $1 AND id = ANY($2::text[]) AND "deletedAt" IS NULL`,
    [tenantId, matIds],
  )) as Array<{ id: string; baseUnit: Unit; lastUnitCost: number | null }>;
  const matById: Record<string, { baseUnit: Unit; lastUnitCost: number | null }> =
    Object.fromEntries(matRows.map((m) => [m.id, { baseUnit: m.baseUnit, lastUnitCost: m.lastUnitCost }]));

  // Group ingredients by recipe → sum batch cost → divide by yield.
  // We capture `yieldUnit` once per item — it's the same on every ingredient row
  // since they all belong to the same recipe.
  const accByItem: Record<string, { yield: number; yieldUnit: Unit; batchCost: number; complete: boolean }> = {};
  for (const r of recipeRows) {
    const m = matById[r.materialId];
    const slot = accByItem[r.itemId] ?? { yield: r.yield, yieldUnit: r.yieldUnit, batchCost: 0, complete: true };
    if (!m || m.lastUnitCost == null || !sameDimension(r.unit, m.baseUnit)) {
      slot.complete = false;
    } else {
      slot.batchCost += convert(r.quantity, r.unit, m.baseUnit) * m.lastUnitCost;
    }
    accByItem[r.itemId] = slot;
  }

  const out: Record<string, RecipeMeta> = {};
  for (const [itemId, agg] of Object.entries(accByItem)) {
    out[itemId] = {
      cost: agg.complete && agg.yield > 0 ? agg.batchCost / agg.yield : null,
      unit: agg.yieldUnit ?? null,
    };
  }
  return out;
}
