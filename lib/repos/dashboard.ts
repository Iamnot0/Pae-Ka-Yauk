import { sql } from '@/lib/neonHttp';
import { computeRecipeCosts } from '@/lib/repos/stocks';

export interface Kpis {
  totalMaterials: number;
  rawMaterialValueMmk: number;
  lowMaterialsCount: number;
}

export interface StockHealth {
  healthy: number;
  low: number;
  outOfStock: number;
}

export interface CategoryValue {
  category: string;
  valueMmk: number;
}

export interface TopMaterial {
  id: string;
  name: string;
  nameLocal: string | null;
  valueMmk: number;
}

export interface TrendPoint {
  day: string;      // 'YYYY-MM-DD'
  in: number;
  out: number;
}

export interface OutOfStockAlert {
  id: string;
  name: string;
  nameLocal: string | null;
  unit: string;
}

export interface LowStockAlert {
  id: string;
  name: string;
  nameLocal: string | null;
  unit: string;
  onHand: number;
  parLevel: number;
}

export interface ExpiringAlert {
  batchId: string;
  materialId: string;
  name: string;
  nameLocal: string | null;
  unit: string;
  remainingQty: number;
  expiryDate: string; // 'YYYY-MM-DD'
}

export interface StockAlerts {
  outOfStock: OutOfStockAlert[];
  lowStock: LowStockAlert[];
  expiring: ExpiringAlert[];
}

export interface MaterialSearchHit {
  id: string;
  name: string;
  nameLocal: string | null;
  category: string;
  baseUnit: string;
  onHand: number;
}

export interface StocksHealth {
  inStock: number;     // sellable_items with finishedGoodsOnHand > 5 (healthy)
  low: number;         // 0 < finishedGoodsOnHand <= 5 (running low — bake soon)
  outOfStock: number;  // finishedGoodsOnHand <= 0 (cashier can't ring this)
}

export interface StocksKpis {
  totalStocks: number;
  lowStocksCount: number;
  stocksExpiringSoonCount: number;
}

/**
 * Stocks-side KPI counts. "Low" uses a hard-coded threshold of 5 finished
 * units until per-stock alert levels exist on sellable_items — at which
 * point swap the literal for a column reference and drop the constant.
 */
export async function getStocksKpis(tenantId: string): Promise<StocksKpis> {
  const rows = (await sql(
    `WITH stocks AS (
       SELECT id, "finishedGoodsOnHand"::float8 AS on_hand, "shelfLifeDays"
         FROM sellable_items
        WHERE "tenantId" = $1
          AND active = true
          AND "deletedAt" IS NULL
          AND "productionMode" = 'BATCH'
     ),
     latest_batch AS (
       SELECT DISTINCT ON (pb."itemId")
              pb."itemId", pb."createdAt"
         FROM production_batches pb
        WHERE pb."tenantId" = $1
        ORDER BY pb."itemId", pb."createdAt" DESC
     )
     SELECT
       (SELECT COUNT(*) FROM stocks)::int AS "totalStocks",
       (SELECT COUNT(*) FROM stocks WHERE on_hand > 0 AND on_hand <= 5)::int AS "lowStocksCount",
       (
         SELECT COUNT(*)::int
           FROM stocks s
           JOIN latest_batch lb ON lb."itemId" = s.id
          WHERE s."shelfLifeDays" IS NOT NULL
            AND s.on_hand > 0
            AND lb."createdAt" + (s."shelfLifeDays" || ' days')::interval
                  BETWEEN NOW() AND NOW() + INTERVAL '7 days'
       ) AS "stocksExpiringSoonCount"`,
    [tenantId],
  )) as StocksKpis[];
  return rows[0] ?? { totalStocks: 0, lowStocksCount: 0, stocksExpiringSoonCount: 0 };
}

/**
 * Stocks (finished-goods) health — three buckets matching the raw-material donut.
 * "Low" uses a hard-coded threshold of 5 finished units (same constant as
 * getStocksKpis.lowStocksCount). Once `sellable_items.lowStockThreshold`
 * exists we swap the literal for a column reference.
 */
export async function getStocksHealth(tenantId: string): Promise<StocksHealth> {
  const rows = (await sql(
    `SELECT
       COUNT(*) FILTER (WHERE "productionMode" = 'BATCH' AND "finishedGoodsOnHand" >  5)::int                                    AS "inStock",
       COUNT(*) FILTER (WHERE "productionMode" = 'BATCH' AND "finishedGoodsOnHand" >  0 AND "finishedGoodsOnHand" <= 5)::int     AS "low",
       COUNT(*) FILTER (WHERE "productionMode" = 'BATCH' AND "finishedGoodsOnHand" <= 0)::int                                    AS "outOfStock"
     FROM sellable_items
     WHERE "tenantId" = $1
       AND active = true
       AND "deletedAt" IS NULL`,
    [tenantId],
  )) as StocksHealth[];
  return rows[0] ?? { inStock: 0, low: 0, outOfStock: 0 };
}

/**
 * Stocks expiring within ≤7 days. For each item that has shelfLifeDays set,
 * we check the latest production batch — if it still has time left and that
 * remaining time is ≤ 7 days, we count the item. Items without a shelf-life
 * value or without a recent bake are excluded (no expiry to track).
 *
 * Caveat: production_batches don't carry "remaining qty" so we approximate
 * "still on the shelf" by also requiring sellable_items.finishedGoodsOnHand > 0.
 */
export async function getStocksExpiringSoonCount(tenantId: string): Promise<number> {
  const rows = (await sql(
    `WITH latest AS (
       SELECT DISTINCT ON (pb."itemId")
              pb."itemId",
              pb."createdAt"
         FROM production_batches pb
         JOIN sellable_items si ON si.id = pb."itemId"
        WHERE si."tenantId" = $1
          AND si."shelfLifeDays" IS NOT NULL
          AND si.active = true
          AND si."deletedAt" IS NULL
          AND si."finishedGoodsOnHand" > 0
        ORDER BY pb."itemId", pb."createdAt" DESC
     )
     SELECT COUNT(*)::int AS n
       FROM latest l
       JOIN sellable_items si ON si.id = l."itemId"
      WHERE l."createdAt" + (si."shelfLifeDays" || ' days')::interval
              BETWEEN NOW() AND NOW() + INTERVAL '7 days'`,
    [tenantId],
  )) as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

// ─────────────────────────────────────────────────────────────────────
// Sales KPIs — revenue, profit, slips, items sold (Yangon-day windowed)
// ─────────────────────────────────────────────────────────────────────

export type SalesPeriod = 'today' | 'week' | 'month';

export interface SalesKpis {
  revenueMmk: number;       // SUM(total) — what the cash drawer should see
  profitMmk: number | null; // revenue - COGS estimate; null if any item lacks cost
  slipsCount: number;       // COMPLETED transactions in window
  itemsSold: number;        // SUM(sale_lines.qty)
  costed: number;           // # item-lines that contributed to profit math
  uncosted: number;         // # item-lines whose item lacks a complete recipe
}

export interface TopSellingItem {
  id: string;
  name: string;
  nameLocal: string | null;
  qty: number;
  revenueMmk: number;
}

/** Postgres date-window predicate against sale_transactions.createdAt
 *  in Yangon time, matching the daily slip-reset key elsewhere. Returns the
 *  predicate text (no $ params — period is a closed enum). */
function periodPredicate(period: SalesPeriod): string {
  const tz = `(("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Yangon')::date)`;
  const today = `(NOW() AT TIME ZONE 'Asia/Yangon')::date`;
  switch (period) {
    case 'today': return `${tz} = ${today}`;
    case 'week':  return `${tz} >= ${today} - INTERVAL '6 days'`;
    case 'month': return `${tz} >= ${today} - INTERVAL '29 days'`;
  }
}


// ─────────────────────────────────────────────────────────────────────
// KPIs — totals across the tenant (today)
// ─────────────────────────────────────────────────────────────────────
export async function getKpis(tenantId: string): Promise<Kpis> {
  const rows = (await sql(
    `WITH on_hand AS (
       SELECT m.id,
              m."parLevel"::float8 AS par_level,
              COALESCE(SUM(b."remainingQty"), 0)::float8          AS on_hand,
              COALESCE(SUM(b."remainingQty" * b."unitCost"), 0)::float8 AS stock_value
       FROM raw_materials m
       LEFT JOIN stock_batches b
         ON b."materialId" = m.id AND b."remainingQty" > 0
       WHERE m."tenantId" = $1 AND m.active = true AND m."deletedAt" IS NULL
       GROUP BY m.id
     )
     SELECT
       COUNT(*)::int AS "totalMaterials",
       COALESCE(SUM(stock_value), 0)::float8 AS "rawMaterialValueMmk",
       COUNT(*) FILTER (
         WHERE par_level IS NOT NULL AND on_hand > 0 AND on_hand < par_level
       )::int AS "lowMaterialsCount"
     FROM on_hand`,
    [tenantId]
  )) as Kpis[];
  return rows[0] ?? { totalMaterials: 0, rawMaterialValueMmk: 0, lowMaterialsCount: 0 };
}

// ─────────────────────────────────────────────────────────────────────
// Stock health — material counts bucketed by status
// ─────────────────────────────────────────────────────────────────────
export async function getStockHealth(tenantId: string): Promise<StockHealth> {
  const rows = (await sql(
    `WITH on_hand AS (
       SELECT m.id,
              m."parLevel"::float8 AS par_level,
              COALESCE(SUM(b."remainingQty"), 0)::float8 AS on_hand
       FROM raw_materials m
       LEFT JOIN stock_batches b
         ON b."materialId" = m.id AND b."remainingQty" > 0
       WHERE m."tenantId" = $1 AND m.active = true AND m."deletedAt" IS NULL
       GROUP BY m.id
     )
     SELECT
       COUNT(*) FILTER (
         WHERE on_hand > 0 AND (par_level IS NULL OR on_hand >= par_level)
       )::int AS healthy,
       COUNT(*) FILTER (
         WHERE on_hand > 0 AND par_level IS NOT NULL AND on_hand < par_level
       )::int AS low,
       COUNT(*) FILTER (WHERE on_hand = 0)::int AS "outOfStock"
     FROM on_hand`,
    [tenantId]
  )) as StockHealth[];
  return rows[0] ?? { healthy: 0, low: 0, outOfStock: 0 };
}

// ─────────────────────────────────────────────────────────────────────
// Value by category — MMK grouped by MaterialCategory
// ─────────────────────────────────────────────────────────────────────
export async function getValueByCategory(tenantId: string): Promise<CategoryValue[]> {
  return (await sql(
    `SELECT m.category::text AS category,
            COALESCE(SUM(b."remainingQty" * b."unitCost"), 0)::float8 AS "valueMmk"
     FROM raw_materials m
     LEFT JOIN stock_batches b
       ON b."materialId" = m.id AND b."remainingQty" > 0
     WHERE m."tenantId" = $1 AND m.active = true AND m."deletedAt" IS NULL
     GROUP BY m.category
     HAVING COALESCE(SUM(b."remainingQty" * b."unitCost"), 0) > 0
     ORDER BY "valueMmk" DESC`,
    [tenantId]
  )) as CategoryValue[];
}

// ─────────────────────────────────────────────────────────────────────
// Top materials by stock value
// ─────────────────────────────────────────────────────────────────────
export async function getTopMaterialsByValue(tenantId: string, limit = 10): Promise<TopMaterial[]> {
  return (await sql(
    `SELECT m.id, m.name, m."nameLocal",
            COALESCE(SUM(b."remainingQty" * b."unitCost"), 0)::float8 AS "valueMmk"
     FROM raw_materials m
     LEFT JOIN stock_batches b
       ON b."materialId" = m.id AND b."remainingQty" > 0
     WHERE m."tenantId" = $1 AND m.active = true AND m."deletedAt" IS NULL
     GROUP BY m.id, m.name, m."nameLocal"
     HAVING COALESCE(SUM(b."remainingQty" * b."unitCost"), 0) > 0
     ORDER BY "valueMmk" DESC
     LIMIT $2`,
    [tenantId, limit]
  )) as TopMaterial[];
}

// ─────────────────────────────────────────────────────────────────────
// Raw-material movement trend — last 30 days, IN vs OUT
// WASTE is reason='WASTE' on kind='OUT', so "OUT" already includes waste.
// Sourced from stock_movements (raw_materials ledger).
// ─────────────────────────────────────────────────────────────────────
export async function getMovementTrend30d(tenantId: string): Promise<TrendPoint[]> {
  return (await sql(
    `WITH days AS (
       SELECT generate_series(
         CURRENT_DATE - INTERVAL '29 days',
         CURRENT_DATE,
         '1 day'::interval
       )::date AS day
     ),
     agg AS (
       SELECT DATE_TRUNC('day', "createdAt")::date AS day,
              SUM(CASE WHEN kind = 'IN'  THEN ABS(qty) ELSE 0 END)::float8 AS in_qty,
              SUM(CASE WHEN kind = 'OUT' THEN ABS(qty) ELSE 0 END)::float8 AS out_qty
       FROM stock_movements
       WHERE "tenantId" = $1
         AND "createdAt" >= CURRENT_DATE - INTERVAL '29 days'
       GROUP BY 1
     )
     SELECT TO_CHAR(d.day, 'YYYY-MM-DD') AS day,
            COALESCE(a.in_qty,  0)::float8 AS "in",
            COALESCE(a.out_qty, 0)::float8 AS "out"
     FROM days d
     LEFT JOIN agg a ON a.day = d.day
     ORDER BY d.day ASC`,
    [tenantId]
  )) as TrendPoint[];
}

// ─────────────────────────────────────────────────────────────────────
// Stocks (finished-goods) movement trend — last 30 days.
//   IN  = sum of production_batches.actualYield (bake events)
//   OUT = sum of sale_lines.qty for COMPLETED transactions
// Returned bucketed per Yangon-day so the chart matches the daily slip
// reset semantics elsewhere.
// ─────────────────────────────────────────────────────────────────────
export async function getStocksMovementTrend30d(tenantId: string): Promise<TrendPoint[]> {
  return (await sql(
    `WITH days AS (
       SELECT generate_series(
         CURRENT_DATE - INTERVAL '29 days',
         CURRENT_DATE,
         '1 day'::interval
       )::date AS day
     ),
     prod AS (
       SELECT (("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Yangon')::date) AS day,
              SUM("actualYield")::float8 AS in_qty
         FROM production_batches
        WHERE "tenantId" = $1
          AND "createdAt" >= NOW() - INTERVAL '30 days'
        GROUP BY 1
     ),
     sales AS (
       SELECT (("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Yangon')::date) AS day,
              SUM(qty)::float8 AS out_qty
         FROM (
           SELECT st."createdAt", sl.qty
             FROM sale_lines sl
             JOIN sale_transactions st ON st.id = sl."saleId"
            WHERE st."tenantId" = $1
              AND st.status = 'COMPLETED'
              AND st."createdAt" >= NOW() - INTERVAL '30 days'
         ) x
        GROUP BY 1
     )
     SELECT TO_CHAR(d.day, 'YYYY-MM-DD') AS day,
            COALESCE(p.in_qty,  0)::float8 AS "in",
            COALESCE(s.out_qty, 0)::float8 AS "out"
       FROM days d
       LEFT JOIN prod  p ON p.day = d.day
       LEFT JOIN sales s ON s.day = d.day
      ORDER BY d.day ASC`,
    [tenantId],
  )) as TrendPoint[];
}

// ─────────────────────────────────────────────────────────────────────
// Alerts — three buckets for the header bell
// ─────────────────────────────────────────────────────────────────────
export async function getStockAlerts(tenantId: string): Promise<StockAlerts> {
  const [outOfStock, lowStock, expiring] = await Promise.all([
    sql(
      `WITH on_hand AS (
         SELECT m.id, m.name, m."nameLocal", m."baseUnit"::text AS unit,
                COALESCE(SUM(b."remainingQty"), 0)::float8 AS on_hand
         FROM raw_materials m
         LEFT JOIN stock_batches b
           ON b."materialId" = m.id AND b."remainingQty" > 0
         WHERE m."tenantId" = $1 AND m.active = true AND m."deletedAt" IS NULL
         GROUP BY m.id
       )
       SELECT id, name, "nameLocal", unit
       FROM on_hand
       WHERE on_hand = 0
       ORDER BY name ASC`,
      [tenantId]
    ) as unknown as Promise<OutOfStockAlert[]>,

    sql(
      `WITH on_hand AS (
         SELECT m.id, m.name, m."nameLocal", m."baseUnit"::text AS unit,
                m."parLevel"::float8 AS par_level,
                COALESCE(SUM(b."remainingQty"), 0)::float8 AS on_hand
         FROM raw_materials m
         LEFT JOIN stock_batches b
           ON b."materialId" = m.id AND b."remainingQty" > 0
         WHERE m."tenantId" = $1 AND m.active = true AND m."deletedAt" IS NULL
         GROUP BY m.id
       )
       SELECT id, name, "nameLocal", unit,
              on_hand AS "onHand",
              par_level AS "parLevel"
       FROM on_hand
       WHERE on_hand > 0 AND par_level IS NOT NULL AND on_hand < par_level
       ORDER BY (on_hand / NULLIF(par_level, 0)) ASC, name ASC`,
      [tenantId]
    ) as unknown as Promise<LowStockAlert[]>,

    sql(
      `SELECT b.id AS "batchId",
              b."materialId",
              m.name,
              m."nameLocal",
              m."baseUnit"::text AS unit,
              b."remainingQty"::float8 AS "remainingQty",
              TO_CHAR(b."expiryDate", 'YYYY-MM-DD') AS "expiryDate"
       FROM stock_batches b
       JOIN raw_materials m ON m.id = b."materialId"
       WHERE m."tenantId" = $1
         AND m.active = true
         AND m."deletedAt" IS NULL
         AND b."expiryDate" BETWEEN NOW() AND NOW() + INTERVAL '7 days'
         AND b."remainingQty" > 0
       ORDER BY b."expiryDate" ASC`,
      [tenantId]
    ) as unknown as Promise<ExpiringAlert[]>,
  ]);

  return { outOfStock, lowStock, expiring };
}

/**
 * Sales KPIs for the dashboard (Today / Week / Month).
 *
 * Revenue is authoritative (sum of completed-sale totals — already includes
 * tax + delivery). Profit is *best-effort*: cost-per-unit comes from the
 * active recipe's BOM × material.lastUnitCost (same path /stocks uses).
 * If any sold item has an incomplete recipe (missing cost or unit
 * mismatch), it's counted in `uncosted` and excluded from profit. Profit
 * is returned as `null` only if NO item could be costed — otherwise we
 * return a partial profit figure with the uncosted counter exposed so the
 * UI can display a "covers N of M items" caveat.
 */
export async function getSalesKpis(tenantId: string, period: SalesPeriod): Promise<SalesKpis> {
  const where = periodPredicate(period);

  // Aggregates from sale_transactions + sale_lines in one trip each.
  // Note: status='COMPLETED' filter — voids should not count.
  const txAgg = (await sql(
    `SELECT
        COALESCE(SUM(total), 0)::float8     AS "revenueMmk",
        COUNT(*)::int                         AS "slipsCount"
       FROM sale_transactions
      WHERE "tenantId" = $1
        AND status = 'COMPLETED'
        AND ${where}`,
    [tenantId],
  )) as Array<{ revenueMmk: number; slipsCount: number }>;

  const lineAgg = (await sql(
    `SELECT sl."itemId",
            SUM(sl.qty)::float8        AS "qty",
            SUM(sl."lineTotal")::float8 AS "revenue"
       FROM sale_lines sl
       JOIN sale_transactions st ON st.id = sl."saleId"
      WHERE st."tenantId" = $1
        AND st.status = 'COMPLETED'
        AND ${where.replace(/"createdAt"/g, 'st."createdAt"')}
      GROUP BY sl."itemId"`,
    [tenantId],
  )) as Array<{ itemId: string; qty: number; revenue: number }>;

  const itemsSold = lineAgg.reduce((acc, r) => acc + r.qty, 0);

  // Cost lookup — null if recipe missing or incomplete.
  const recipeCosts = await computeRecipeCosts(tenantId);
  let cogs = 0;
  let costed = 0;
  let uncosted = 0;
  for (const r of lineAgg) {
    const rc = recipeCosts[r.itemId];
    if (rc?.cost != null) {
      cogs += r.qty * rc.cost;
      costed += 1;
    } else if (r.qty > 0) {
      uncosted += 1;
    }
  }

  const revenueMmk = txAgg[0]?.revenueMmk ?? 0;
  const slipsCount = txAgg[0]?.slipsCount ?? 0;

  return {
    revenueMmk,
    profitMmk: costed === 0 ? null : revenueMmk - cogs,
    slipsCount,
    itemsSold,
    costed,
    uncosted,
  };
}

/** Top N selling items in window, ranked by qty (ties broken by revenue). */
export async function getTopSellingItems(
  tenantId: string,
  period: SalesPeriod,
  limit = 8,
): Promise<TopSellingItem[]> {
  const where = periodPredicate(period).replace(/"createdAt"/g, 'st."createdAt"');
  return (await sql(
    `SELECT si.id,
            si.name,
            si."nameLocal",
            SUM(sl.qty)::float8         AS qty,
            SUM(sl."lineTotal")::float8 AS "revenueMmk"
       FROM sale_lines sl
       JOIN sale_transactions st ON st.id = sl."saleId"
       JOIN sellable_items si    ON si.id = sl."itemId"
      WHERE st."tenantId" = $1
        AND st.status = 'COMPLETED'
        AND ${where}
      GROUP BY si.id, si.name, si."nameLocal"
      ORDER BY qty DESC, "revenueMmk" DESC
      LIMIT $2`,
    [tenantId, limit],
  )) as TopSellingItem[];
}

// ─────────────────────────────────────────────────────────────────────
// Search — header typeahead. Matches name OR nameLocal, ILIKE.
// ─────────────────────────────────────────────────────────────────────
export async function searchMaterials(
  tenantId: string,
  q: string,
  limit = 10
): Promise<MaterialSearchHit[]> {
  const needle = q.trim();
  if (needle.length < 2) return [];
  return (await sql(
    `WITH on_hand AS (
       SELECT m.id, m.name, m."nameLocal",
              m.category::text AS category,
              m."baseUnit"::text AS "baseUnit",
              COALESCE(SUM(b."remainingQty"), 0)::float8 AS on_hand
       FROM raw_materials m
       LEFT JOIN stock_batches b
         ON b."materialId" = m.id AND b."remainingQty" > 0
       WHERE m."tenantId" = $1
         AND m.active = true
         AND m."deletedAt" IS NULL
         AND (m.name ILIKE '%' || $2 || '%' OR m."nameLocal" ILIKE '%' || $2 || '%')
       GROUP BY m.id
     )
     SELECT id, name, "nameLocal", category, "baseUnit",
            on_hand AS "onHand"
     FROM on_hand
     ORDER BY name ASC
     LIMIT $3`,
    [tenantId, needle, limit]
  )) as MaterialSearchHit[];
}
