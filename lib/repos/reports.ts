import { sql } from '@/lib/neonHttp';
import { toDisplayCategory, DISPLAY_CATEGORY_ORDER } from '@/lib/categories';
import type { ItemCategory } from '@/lib/repos/items';

// ─────────────────────────────────────────────────────────────────────
// Period model — rolling windows over wall-clock days in the tenant's
// local timezone (default Asia/Yangon). Boundary math runs in SQL so the
// query is one round-trip; client formats display strings.
//
// Times: server hands back **UTC ISO strings** for `createdAt` etc. The
// client renders via lib/format/datetime.ts which uses the browser's
// resolved timezone — accurate regardless of where data was stored or
// where the user is sitting.
// ─────────────────────────────────────────────────────────────────────
export type ReportPeriod = 'daily' | 'weekly' | 'monthly';

export function periodDays(p: ReportPeriod): number {
  return p === 'daily' ? 1 : p === 'weekly' ? 7 : 30;
}

const TENANT_TZ = 'Asia/Yangon';

// ─────────────────────────────────────────────────────────────────────
// 1. Transactions report
// ─────────────────────────────────────────────────────────────────────
export interface TransactionsSummary {
  revenue: number;
  saleCount: number;
  avgSale: number;
  voidCount: number;
  taxTotal: number;          // SUM(taxTotal) for completed sales
  deliveryFeeTotal: number;  // SUM(deliveryFee) for completed sales
}

export interface DailyRevenuePoint {
  day: string;        // 'YYYY-MM-DD' in tenant TZ
  revenue: number;
  saleCount: number;
}

export interface TopItemRow {
  itemId: string;
  name: string;
  qty: number;
  revenue: number;
  unitPrice: number;
}

export interface TenderMixRow {
  tenderType: string;
  count: number;
  total: number;
}

export interface ModeMixRow {
  modeAtCreation: 'POS_PAUSED' | 'FULL';
  count: number;
  total: number;
}

export interface SaleRow {
  id: string;
  receiptNumber: string;
  /** Naked UTC ISO — client renders via Intl.DateTimeFormat */
  createdAtIso: string;
  total: number;
  itemCount: number;
  tenderType: string;
  status: string;
}

export interface SaleLineRow {
  name: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

/** Slip-details detail: a sale row with its line items expanded. Adds the
 *  per-slip tax + delivery so the PDF can render a proper Subtotal · Tax ·
 *  Delivery · Total breakdown under each receipt header. */
export interface SaleWithLines extends SaleRow {
  lines: SaleLineRow[];
  taxTotal: number;
  deliveryFee: number;
}

export interface TransactionsReport {
  summary: TransactionsSummary;
  dailyRevenue: DailyRevenuePoint[];
  topItems: TopItemRow[];
  tenderMix: TenderMixRow[];
  modeMix: ModeMixRow[];
  recentSales: SaleRow[];
  /** Same period as recentSales, top 50 most recent COMPLETED sales with
   *  their line items expanded — drives the PDF "Slip Details" section. */
  salesWithLines: SaleWithLines[];
}

export async function getTransactionsReport(tenantId: string, period: ReportPeriod): Promise<TransactionsReport> {
  const days = periodDays(period);
  // Day-bucketing in tenant tz so a midnight-Yangon sale doesn't drift to the
  // wrong calendar day. `today_local` is the current Yangon date; the window
  // starts (days-1) days back from there. We then convert the boundary back
  // to a timestamptz for `createdAt >=` filtering.
  const fromExpr = `(date_trunc('day', NOW() AT TIME ZONE '${TENANT_TZ}') - INTERVAL '${days - 1} days') AT TIME ZONE '${TENANT_TZ}'`;
  const todayLocalExpr = `(NOW() AT TIME ZONE '${TENANT_TZ}')::date`;
  const fromLocalExpr  = `(date_trunc('day', NOW() AT TIME ZONE '${TENANT_TZ}') - INTERVAL '${days - 1} days')::date`;

  const [summaryRows, dailyRows, topItems, tenderMix, modeMix, recentSales, slipLines] = await Promise.all([
    sql(
      `SELECT
         COALESCE(SUM(total)       FILTER (WHERE status = 'COMPLETED'), 0)::float8 AS revenue,
         COALESCE(SUM("taxTotal")  FILTER (WHERE status = 'COMPLETED'), 0)::float8 AS "taxTotal",
         COALESCE(SUM("deliveryFee") FILTER (WHERE status = 'COMPLETED'), 0)::float8 AS "deliveryFeeTotal",
         COUNT(*) FILTER (WHERE status = 'COMPLETED')::int                          AS "saleCount",
         COUNT(*) FILTER (WHERE status = 'VOIDED')::int                              AS "voidCount"
       FROM sale_transactions
       WHERE "tenantId" = $1 AND "createdAt" >= ${fromExpr}`,
      [tenantId]
    ) as unknown as Promise<Array<{ revenue: number; saleCount: number; voidCount: number; taxTotal: number; deliveryFeeTotal: number }>>,

    sql(
      `WITH days AS (
         SELECT generate_series(${fromLocalExpr}, ${todayLocalExpr}, '1 day'::interval)::date AS day
       ),
       agg AS (
         SELECT (("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE '${TENANT_TZ}')::date) AS day,
                SUM(total)::float8                                                   AS revenue,
                COUNT(*)::int                                                        AS "saleCount"
         FROM sale_transactions
         WHERE "tenantId" = $1 AND status = 'COMPLETED' AND "createdAt" >= ${fromExpr}
         GROUP BY 1
       )
       SELECT TO_CHAR(d.day, 'YYYY-MM-DD') AS day,
              COALESCE(a.revenue, 0)::float8 AS revenue,
              COALESCE(a."saleCount", 0)::int AS "saleCount"
       FROM days d LEFT JOIN agg a ON a.day = d.day
       ORDER BY d.day ASC`,
      [tenantId]
    ) as unknown as Promise<DailyRevenuePoint[]>,

    sql(
      `SELECT sl."itemId",
              sl."itemNameSnapshot"      AS name,
              SUM(sl.qty)::float8        AS qty,
              SUM(sl."lineTotal")::float8 AS revenue,
              (SUM(sl."lineTotal") / NULLIF(SUM(sl.qty), 0))::float8 AS "unitPrice"
       FROM sale_lines sl
       JOIN sale_transactions st ON st.id = sl."saleId"
       WHERE st."tenantId" = $1 AND st.status = 'COMPLETED' AND st."createdAt" >= ${fromExpr}
       GROUP BY sl."itemId", sl."itemNameSnapshot"
       ORDER BY revenue DESC
       LIMIT 10`,
      [tenantId]
    ) as unknown as Promise<TopItemRow[]>,

    sql(
      `SELECT "tenderType"::text AS "tenderType",
              COUNT(*)::int       AS count,
              COALESCE(SUM(total), 0)::float8 AS total
       FROM sale_transactions
       WHERE "tenantId" = $1 AND status = 'COMPLETED' AND "createdAt" >= ${fromExpr}
       GROUP BY 1
       ORDER BY total DESC`,
      [tenantId]
    ) as unknown as Promise<TenderMixRow[]>,

    sql(
      `SELECT COALESCE("modeAtCreation", 'POS_PAUSED')::text AS "modeAtCreation",
              COUNT(*)::int       AS count,
              COALESCE(SUM(total), 0)::float8 AS total
       FROM sale_transactions
       WHERE "tenantId" = $1 AND status = 'COMPLETED' AND "createdAt" >= ${fromExpr}
       GROUP BY 1
       ORDER BY total DESC`,
      [tenantId]
    ) as unknown as Promise<ModeMixRow[]>,

    sql(
      `SELECT st.id,
              st."receiptNumber",
              -- Hand back UTC ISO; client renders via Intl.DateTimeFormat()
              (st."createdAt" AT TIME ZONE 'UTC')::text AS "createdAtIso",
              st.total::float8        AS total,
              st."taxTotal"::float8   AS "taxTotal",
              st."deliveryFee"::float8 AS "deliveryFee",
              st."tenderType"::text   AS "tenderType",
              st.status::text         AS status,
              (SELECT COUNT(*)::int FROM sale_lines WHERE "saleId" = st.id) AS "itemCount"
       FROM sale_transactions st
       WHERE st."tenantId" = $1 AND st."createdAt" >= ${fromExpr}
       ORDER BY st."createdAt" DESC
       LIMIT 200`,
      [tenantId]
    ) as unknown as Promise<Array<SaleRow & { taxTotal: number; deliveryFee: number }>>,

    // Line items for the most recent 50 completed sales — drives the
    // Slip Details PDF section. Capped at 50 to keep the PDF a sane size
    // even on a busy month.
    sql(
      `SELECT sl."saleId",
              sl."itemNameSnapshot" AS name,
              sl.qty::float8        AS qty,
              sl."unitPrice"::float8 AS "unitPrice",
              sl."lineTotal"::float8 AS "lineTotal"
       FROM sale_lines sl
       WHERE sl."saleId" IN (
         SELECT id FROM sale_transactions
         WHERE "tenantId" = $1 AND status = 'COMPLETED' AND "createdAt" >= ${fromExpr}
         ORDER BY "createdAt" DESC
         LIMIT 50
       )
       ORDER BY sl."saleId", sl."sortOrder" ASC, sl.id ASC`,
      [tenantId]
    ) as unknown as Promise<Array<{ saleId: string } & SaleLineRow>>,
  ]);

  // Group line items by saleId so the PDF generator can iterate sales →
  // lines without an O(N²) join in the renderer.
  const linesBySale = new Map<string, SaleLineRow[]>();
  for (const r of slipLines) {
    const arr = linesBySale.get(r.saleId);
    const line: SaleLineRow = {
      name: r.name, qty: r.qty, unitPrice: r.unitPrice, lineTotal: r.lineTotal,
    };
    if (arr) arr.push(line); else linesBySale.set(r.saleId, [line]);
  }
  const salesWithLines: SaleWithLines[] = recentSales
    .filter((s) => s.status === 'COMPLETED' && linesBySale.has(s.id))
    .slice(0, 50)
    .map((s) => ({
      ...s,
      lines: linesBySale.get(s.id) ?? [],
      taxTotal: s.taxTotal ?? 0,
      deliveryFee: s.deliveryFee ?? 0,
    }));

  const s = summaryRows[0] ?? { revenue: 0, saleCount: 0, voidCount: 0, taxTotal: 0, deliveryFeeTotal: 0 };
  return {
    summary: {
      revenue: s.revenue,
      saleCount: s.saleCount,
      voidCount: s.voidCount,
      avgSale: s.saleCount > 0 ? s.revenue / s.saleCount : 0,
      taxTotal: s.taxTotal,
      deliveryFeeTotal: s.deliveryFeeTotal,
    },
    dailyRevenue: dailyRows,
    topItems,
    tenderMix,
    modeMix,
    recentSales,
    salesWithLines,
  };
}

// ─────────────────────────────────────────────────────────────────────
// 2. Stock activity report
//
// Reports activity on FINISHED GOODS — the events the bakery owner
// actually creates day-to-day in POS-PAUSED mode:
//   • RECEIVED  — owner logs a finished-goods receipt via Receive Stocks
//                 modal (production_batches.source='RECEIVED')
//   • BAKED     — baker logs a bake batch via /production
//                 (production_batches.source='BAKED')
//   • SOLD      — sum of sale_lines.qty for BATCH items in completed sales
//   • DAMAGED   — stock_adjustments with category='DAMAGED' / 'SPOILED'
//   • FOC       — stock_adjustments with category='FOC'
//
// Raw-material movements (`stock_movements`) are intentionally NOT
// surfaced here in PAUSED — they're empty by design (Hard Rule #1 says
// BOM deduction is bypassed). When tenant flips to FULL we'll add a
// raw-material activity sub-section.
// ─────────────────────────────────────────────────────────────────────
export interface StockActivitySummary {
  receivedEvents: number;     // count of source='RECEIVED' batches
  receivedQty: number;        // SUM(actualYield) for received batches
  bakedEvents: number;        // count of source='BAKED' batches
  bakedQty: number;           // SUM(actualYield) for baked batches
  soldQty: number;            // SUM(sale_lines.qty) where item is BATCH
  damagedQty: number;         // SUM(stock_adjustments.qty) DAMAGED|SPOILED
  focQty: number;             // SUM(stock_adjustments.qty) FOC
}

export interface DailyStockActivity {
  day: string;
  inCount: number;   // RECEIVED + BAKED batches that day
  outCount: number;  // sale_lines events that day for BATCH items
}

export interface TopMovedItem {
  itemId: string;
  name: string;
  nameLocal: string | null;
  receivedQty: number;
  bakedQty: number;
  soldQty: number;
  netQty: number;          // (received + baked) − sold
}

export interface FgCategoryRow {
  category: string;        // sellable_items.category enum value
  itemCount: number;       // # items in this category
  onHandQty: number;       // sum of finishedGoodsOnHand for BATCH items only
}

export interface FgOutOfStockRow {
  id: string;
  name: string;
  nameLocal: string | null;
  category: string;
}

export interface AdjustmentRow {
  id: string;
  itemName: string;
  /** DAMAGED | FOC | SPOILED | OTHER */
  category: string;
  qty: number;
  reason: string | null;
  note: string | null;
  /** UTC ISO — PDF formats via formatDateTimeInTz. */
  createdAtIso: string;
  byName: string | null;
}

export interface StockActivityReport {
  summary: StockActivitySummary;
  dailyActivity: DailyStockActivity[];
  topMoved: TopMovedItem[];
  /** Finished-goods inventory: items grouped by category. */
  fgByCategory: FgCategoryRow[];
  /** BATCH sellable items that are currently at zero on-hand. */
  fgOutOfStock: FgOutOfStockRow[];
  /** Per-entry DMG / FOC / SPOILED log over the report period (≤200). */
  adjustments: AdjustmentRow[];
}

export async function getStockActivityReport(tenantId: string, period: ReportPeriod): Promise<StockActivityReport> {
  const days = periodDays(period);
  const fromExpr = `(date_trunc('day', NOW() AT TIME ZONE '${TENANT_TZ}') - INTERVAL '${days - 1} days') AT TIME ZONE '${TENANT_TZ}'`;
  const todayLocalExpr = `(NOW() AT TIME ZONE '${TENANT_TZ}')::date`;
  const fromLocalExpr  = `(date_trunc('day', NOW() AT TIME ZONE '${TENANT_TZ}') - INTERVAL '${days - 1} days')::date`;

  const [summaryRows, dailyRows, topMoved, fgByCategory, fgOutOfStock, adjustments] = await Promise.all([
    sql(
      `WITH batches AS (
         SELECT source, "actualYield"::float8 AS qty
         FROM production_batches
         WHERE "tenantId" = $1 AND "createdAt" >= ${fromExpr}
       ),
       sales_qty AS (
         SELECT COALESCE(SUM(sl.qty), 0)::float8 AS sold
         FROM sale_lines sl
         JOIN sale_transactions st ON st.id = sl."saleId"
         JOIN sellable_items si ON si.id = sl."itemId"
         WHERE st."tenantId" = $1 AND st.status = 'COMPLETED'
           AND st."createdAt" >= ${fromExpr}
           AND si."productionMode" = 'BATCH'
       ),
       adj AS (
         SELECT
           COALESCE(SUM(qty) FILTER (WHERE category IN ('DAMAGED', 'SPOILED')), 0)::float8 AS damaged,
           COALESCE(SUM(qty) FILTER (WHERE category = 'FOC'), 0)::float8                    AS foc
         FROM stock_adjustments
         WHERE "tenantId" = $1 AND "createdAt" >= ${fromExpr}
       )
       SELECT
         COUNT(*) FILTER (WHERE source = 'RECEIVED')::int                              AS "receivedEvents",
         COALESCE(SUM(qty) FILTER (WHERE source = 'RECEIVED'), 0)::float8              AS "receivedQty",
         COUNT(*) FILTER (WHERE source = 'BAKED')::int                                  AS "bakedEvents",
         COALESCE(SUM(qty) FILTER (WHERE source = 'BAKED'), 0)::float8                  AS "bakedQty",
         (SELECT sold FROM sales_qty)::float8                                           AS "soldQty",
         (SELECT damaged FROM adj)::float8                                              AS "damagedQty",
         (SELECT foc FROM adj)::float8                                                  AS "focQty"
       FROM batches`,
      [tenantId],
    ) as unknown as Promise<StockActivitySummary[]>,

    sql(
      `WITH days AS (
         SELECT generate_series(${fromLocalExpr}, ${todayLocalExpr}, '1 day'::interval)::date AS day
       ),
       in_agg AS (
         SELECT (("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE '${TENANT_TZ}')::date) AS day,
                COUNT(*)::int AS "inCount"
         FROM production_batches
         WHERE "tenantId" = $1 AND "createdAt" >= ${fromExpr}
         GROUP BY 1
       ),
       out_agg AS (
         SELECT ((st."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE '${TENANT_TZ}')::date) AS day,
                COUNT(DISTINCT sl.id)::int AS "outCount"
         FROM sale_lines sl
         JOIN sale_transactions st ON st.id = sl."saleId"
         JOIN sellable_items si ON si.id = sl."itemId"
         WHERE st."tenantId" = $1 AND st.status = 'COMPLETED'
           AND st."createdAt" >= ${fromExpr}
           AND si."productionMode" = 'BATCH'
         GROUP BY 1
       )
       SELECT TO_CHAR(d.day, 'YYYY-MM-DD') AS day,
              COALESCE(i."inCount",  0)::int AS "inCount",
              COALESCE(o."outCount", 0)::int AS "outCount"
       FROM days d
       LEFT JOIN in_agg  i ON i.day = d.day
       LEFT JOIN out_agg o ON o.day = d.day
       ORDER BY d.day ASC`,
      [tenantId],
    ) as unknown as Promise<DailyStockActivity[]>,

    sql(
      `WITH received AS (
         SELECT "itemId", SUM("actualYield")::float8 AS qty
         FROM production_batches
         WHERE "tenantId" = $1 AND source = 'RECEIVED' AND "createdAt" >= ${fromExpr}
         GROUP BY "itemId"
       ),
       baked AS (
         SELECT "itemId", SUM("actualYield")::float8 AS qty
         FROM production_batches
         WHERE "tenantId" = $1 AND source = 'BAKED'    AND "createdAt" >= ${fromExpr}
         GROUP BY "itemId"
       ),
       sold AS (
         SELECT sl."itemId", SUM(sl.qty)::float8 AS qty
         FROM sale_lines sl
         JOIN sale_transactions st ON st.id = sl."saleId"
         JOIN sellable_items si ON si.id = sl."itemId"
         WHERE st."tenantId" = $1 AND st.status = 'COMPLETED'
           AND st."createdAt" >= ${fromExpr}
           AND si."productionMode" = 'BATCH'
         GROUP BY sl."itemId"
       ),
       all_items AS (
         SELECT "itemId" FROM received
         UNION SELECT "itemId" FROM baked
         UNION SELECT "itemId" FROM sold
       )
       SELECT a."itemId"                              AS "itemId",
              si.name,
              si."nameLocal",
              COALESCE(r.qty, 0)::float8              AS "receivedQty",
              COALESCE(b.qty, 0)::float8              AS "bakedQty",
              COALESCE(s.qty, 0)::float8              AS "soldQty",
              (COALESCE(r.qty, 0) + COALESCE(b.qty, 0) - COALESCE(s.qty, 0))::float8 AS "netQty"
       FROM all_items a
       JOIN sellable_items si ON si.id = a."itemId"
       LEFT JOIN received r ON r."itemId" = a."itemId"
       LEFT JOIN baked    b ON b."itemId" = a."itemId"
       LEFT JOIN sold     s ON s."itemId" = a."itemId"
       ORDER BY (COALESCE(r.qty, 0) + COALESCE(b.qty, 0) + COALESCE(s.qty, 0)) DESC
       LIMIT 20`,
      [tenantId],
    ) as unknown as Promise<TopMovedItem[]>,

    // Finished goods grouped by category. On-hand sum is BATCH-only since
    // DIRECT items don't track inventory.
    sql(
      `SELECT category::text                                                            AS category,
              COUNT(*)::int                                                              AS "itemCount",
              COALESCE(SUM("finishedGoodsOnHand") FILTER (WHERE "productionMode" = 'BATCH'), 0)::float8 AS "onHandQty"
         FROM sellable_items
        WHERE "tenantId" = $1 AND active = true AND "deletedAt" IS NULL
        GROUP BY category
        ORDER BY "itemCount" DESC`,
      [tenantId],
    ) as unknown as Promise<FgCategoryRow[]>,

    // BATCH items at zero on-hand (drinks excluded — DIRECT items don't have shelf stock).
    sql(
      `SELECT id, name, "nameLocal", category::text AS category
         FROM sellable_items
        WHERE "tenantId" = $1 AND active = true AND "deletedAt" IS NULL
          AND "productionMode" = 'BATCH'
          AND COALESCE("finishedGoodsOnHand", 0) <= 0
        ORDER BY name ASC`,
      [tenantId],
    ) as unknown as Promise<FgOutOfStockRow[]>,

    // Per-entry DMG / FOC adjustment log over the report period. Newest
    // first, capped at 200 so the PDF stays a sane size on busy weeks.
    sql(
      `SELECT a.id,
              si.name              AS "itemName",
              a.category::text     AS category,
              a.qty::float8        AS qty,
              a.reason,
              a.note,
              (a."createdAt" AT TIME ZONE 'UTC')::text AS "createdAtIso",
              COALESCE(u.name, u.email)               AS "byName"
         FROM stock_adjustments a
         JOIN sellable_items si ON si.id = a."itemId"
         LEFT JOIN users u ON u.id = a."userId"
        WHERE a."tenantId" = $1 AND a."createdAt" >= ${fromExpr}
        ORDER BY a."createdAt" DESC
        LIMIT 200`,
      [tenantId],
    ) as unknown as Promise<AdjustmentRow[]>,
  ]);

  const s = summaryRows[0] ?? {
    receivedEvents: 0, receivedQty: 0, bakedEvents: 0, bakedQty: 0,
    soldQty: 0, damagedQty: 0, focQty: 0,
  };

  // Roll up raw enum categories into display buckets so the on-screen and
  // PDF "By Category" tables match the customer-facing labels:
  // COFFEE_HOT + TEA → Hot Drink, COLD_DRINK + COFFEE_COLD → Cold Drink, etc.
  // Owner brief 2026-04-28.
  const fgByCategoryConsolidated = consolidateByDisplayCategory(fgByCategory);

  return {
    summary: s,
    dailyActivity: dailyRows,
    topMoved,
    fgByCategory: fgByCategoryConsolidated,
    fgOutOfStock,
    adjustments,
  };
}

/**
 * Group raw-enum FgCategoryRow into display-category buckets. Sums itemCount
 * and onHandQty per bucket. Returned in the canonical DISPLAY_CATEGORY_ORDER
 * so the on-screen + PDF tables read consistently.
 */
function consolidateByDisplayCategory(rows: FgCategoryRow[]): FgCategoryRow[] {
  const acc = new Map<string, { itemCount: number; onHandQty: number }>();
  for (const r of rows) {
    const display = toDisplayCategory(r.category as ItemCategory);
    const slot = acc.get(display) ?? { itemCount: 0, onHandQty: 0 };
    slot.itemCount += Number(r.itemCount) || 0;
    slot.onHandQty += Number(r.onHandQty) || 0;
    acc.set(display, slot);
  }
  // Preserve canonical display order, drop empty buckets.
  return DISPLAY_CATEGORY_ORDER
    .filter((d) => acc.has(d))
    .map((d) => ({
      category: d,
      itemCount: acc.get(d)!.itemCount,
      onHandQty: acc.get(d)!.onHandQty,
    }));
}

// ─────────────────────────────────────────────────────────────────────
// 3. Inventory snapshot — point-in-time, not period-scoped
// ─────────────────────────────────────────────────────────────────────
export interface InventoryKpis {
  totalMaterials: number;
  stockValueMmk: number;
  lowStockCount: number;
  outOfStockCount: number;
  expiringSoonCount: number;
}

export interface InventoryByCategoryRow {
  category: string;
  materialCount: number;
  valueMmk: number;
}

export interface OutOfStockRow {
  id: string;
  name: string;
  nameLocal: string | null;
  unit: string;
  parLevel: number | null;
}

export interface LowStockRow {
  id: string;
  name: string;
  nameLocal: string | null;
  unit: string;
  onHand: number;
  parLevel: number;
}

export interface ExpiringRow {
  batchId: string;
  materialId: string;
  name: string;
  nameLocal: string | null;
  unit: string;
  remainingQty: number;
  expiryDate: string;  // YYYY-MM-DD
}

export interface InventorySnapshot {
  asOf: string;  // ISO timestamp
  kpis: InventoryKpis;
  byCategory: InventoryByCategoryRow[];
  outOfStock: OutOfStockRow[];
  lowStock: LowStockRow[];
  expiring: ExpiringRow[];
}

export async function getInventorySnapshot(tenantId: string): Promise<InventorySnapshot> {
  const [kpisRows, byCategory, outOfStock, lowStock, expiring] = await Promise.all([
    sql(
      `WITH on_hand AS (
         SELECT m.id,
                m."parLevel"::float8 AS par_level,
                COALESCE(SUM(b."remainingQty"), 0)::float8          AS on_hand,
                COALESCE(SUM(b."remainingQty" * b."unitCost"), 0)::float8 AS stock_value
         FROM raw_materials m
         LEFT JOIN stock_batches b ON b."materialId" = m.id AND b."remainingQty" > 0
         WHERE m."tenantId" = $1 AND m.active = true AND m."deletedAt" IS NULL
         GROUP BY m.id
       )
       SELECT
         COUNT(*)::int                                                    AS "totalMaterials",
         COALESCE(SUM(stock_value), 0)::float8                            AS "stockValueMmk",
         COUNT(*) FILTER (WHERE par_level IS NOT NULL AND on_hand > 0 AND on_hand < par_level)::int AS "lowStockCount",
         COUNT(*) FILTER (WHERE on_hand = 0)::int                         AS "outOfStockCount",
         (SELECT COUNT(DISTINCT b2."materialId")::int
            FROM stock_batches b2
            JOIN raw_materials m2 ON m2.id = b2."materialId"
           WHERE m2."tenantId" = $1 AND m2.active = true AND m2."deletedAt" IS NULL
             AND b2."expiryDate" BETWEEN NOW() AND NOW() + INTERVAL '7 days'
             AND b2."remainingQty" > 0) AS "expiringSoonCount"
       FROM on_hand`,
      [tenantId]
    ) as unknown as Promise<InventoryKpis[]>,

    sql(
      `SELECT m.category::text AS category,
              COUNT(DISTINCT m.id)::int AS "materialCount",
              COALESCE(SUM(b."remainingQty" * b."unitCost"), 0)::float8 AS "valueMmk"
       FROM raw_materials m
       LEFT JOIN stock_batches b ON b."materialId" = m.id AND b."remainingQty" > 0
       WHERE m."tenantId" = $1 AND m.active = true AND m."deletedAt" IS NULL
       GROUP BY m.category
       ORDER BY "valueMmk" DESC, "materialCount" DESC`,
      [tenantId]
    ) as unknown as Promise<InventoryByCategoryRow[]>,

    sql(
      `WITH on_hand AS (
         SELECT m.id, m.name, m."nameLocal", m."baseUnit"::text AS unit,
                m."parLevel"::float8 AS "parLevel",
                COALESCE(SUM(b."remainingQty"), 0)::float8 AS on_hand
         FROM raw_materials m
         LEFT JOIN stock_batches b ON b."materialId" = m.id AND b."remainingQty" > 0
         WHERE m."tenantId" = $1 AND m.active = true AND m."deletedAt" IS NULL
         GROUP BY m.id
       )
       SELECT id, name, "nameLocal", unit, "parLevel"
       FROM on_hand WHERE on_hand = 0
       ORDER BY name ASC`,
      [tenantId]
    ) as unknown as Promise<OutOfStockRow[]>,

    sql(
      `WITH on_hand AS (
         SELECT m.id, m.name, m."nameLocal", m."baseUnit"::text AS unit,
                m."parLevel"::float8 AS par_level,
                COALESCE(SUM(b."remainingQty"), 0)::float8 AS on_hand
         FROM raw_materials m
         LEFT JOIN stock_batches b ON b."materialId" = m.id AND b."remainingQty" > 0
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
    ) as unknown as Promise<LowStockRow[]>,

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
       WHERE m."tenantId" = $1 AND m.active = true AND m."deletedAt" IS NULL
         AND b."expiryDate" BETWEEN NOW() AND NOW() + INTERVAL '7 days'
         AND b."remainingQty" > 0
       ORDER BY b."expiryDate" ASC`,
      [tenantId]
    ) as unknown as Promise<ExpiringRow[]>,
  ]);

  return {
    asOf: new Date().toISOString(),
    kpis: kpisRows[0] ?? { totalMaterials: 0, stockValueMmk: 0, lowStockCount: 0, outOfStockCount: 0, expiringSoonCount: 0 },
    byCategory,
    outOfStock,
    lowStock,
    expiring,
  };
}
