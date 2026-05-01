-- Stock adjustments — manual corrections to finished-goods (sellable items)
-- on-hand counts. Drives the DMG (damage) and FOC (free-of-charge) columns
-- on the new Stocks page. Each row is an event, not a balance — the running
-- "today/week/all-time" counts shown in the UI come from aggregating these.
--
-- Why a new table instead of reusing waste_entries:
--   waste_entries is keyed on `materialId` (raw materials only). DMG/FOC for
--   sellable_items is conceptually different — it's about finished goods
--   already on the shelf, not raw stock. Keeping them in separate tables
--   keeps reporting clean and avoids overloading WasteEntry's semantics.

CREATE TYPE "StockAdjustmentCategory" AS ENUM ('DAMAGED', 'FOC', 'SPOILED', 'OTHER');

CREATE TABLE IF NOT EXISTS "stock_adjustments" (
  "id"        TEXT NOT NULL,
  "tenantId"  TEXT NOT NULL,
  "itemId"    TEXT NOT NULL,
  "qty"       INTEGER NOT NULL CHECK ("qty" > 0),
  "category"  "StockAdjustmentCategory" NOT NULL,
  "reason"    TEXT,
  "note"      TEXT,
  "userId"    TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "stock_adjustments_pkey"
    PRIMARY KEY ("id"),
  CONSTRAINT "stock_adjustments_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "stock_adjustments_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "sellable_items"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "stock_adjustments_tenant_created_idx"
  ON "stock_adjustments"("tenantId", "createdAt");

CREATE INDEX IF NOT EXISTS "stock_adjustments_tenant_item_category_idx"
  ON "stock_adjustments"("tenantId", "itemId", "category");
