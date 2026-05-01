-- Sprint 3 Step 6: Production batch flow
--
-- Adds the schema pieces needed to model "bake 1 batch → deduct ingredients,
-- credit finished goods, later sell finished goods without re-deducting".

-- 1. Two new MovementReason enum values so production touches the ledger
--    (IF NOT EXISTS makes this idempotent — safe to re-run)
ALTER TYPE "MovementReason" ADD VALUE IF NOT EXISTS 'PRODUCTION_CONSUME';
ALTER TYPE "MovementReason" ADD VALUE IF NOT EXISTS 'PRODUCTION_OUTPUT';

-- 2. ProductionMode enum — distinguishes drinks (deduct on sale) from
--    baked goods (deduct on bake, count finished goods)
DO $$ BEGIN
  CREATE TYPE "ProductionMode" AS ENUM ('DIRECT', 'BATCH');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Add columns to sellable_items
ALTER TABLE "sellable_items"
  ADD COLUMN IF NOT EXISTS "productionMode" "ProductionMode" NOT NULL DEFAULT 'DIRECT';

ALTER TABLE "sellable_items"
  ADD COLUMN IF NOT EXISTS "finishedGoodsOnHand" DECIMAL(14, 4) NOT NULL DEFAULT 0;

-- 4. production_batches table — one row per bake event
CREATE TABLE IF NOT EXISTS "production_batches" (
  "id"             TEXT PRIMARY KEY,                            -- ULID
  "tenantId"       TEXT NOT NULL,
  "outletId"       TEXT,
  "itemId"         TEXT NOT NULL,
  "recipeId"       TEXT,                                         -- may be NULL if recipe deleted later
  "recipeVersion"  INT,
  "batchCount"     DECIMAL(10, 4) NOT NULL,                      -- how many times the recipe was multiplied
  "expectedYield"  DECIMAL(14, 4) NOT NULL,                      -- recipe.yield × batchCount
  "actualYield"    DECIMAL(14, 4) NOT NULL,                      -- what the baker actually produced (could be less)
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "createdBy"      TEXT,                                         -- User.id
  "notes"          TEXT,
  CONSTRAINT "production_batches_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "production_batches_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "outlets"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "production_batches_itemId_fkey"   FOREIGN KEY ("itemId")   REFERENCES "sellable_items"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "production_batches_tenantId_createdAt_idx"
  ON "production_batches" ("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "production_batches_tenantId_itemId_idx"
  ON "production_batches" ("tenantId", "itemId");

-- 5. Link StockMovement → ProductionBatch (for audit drill-down)
ALTER TABLE "stock_movements"
  ADD COLUMN IF NOT EXISTS "productionBatchId" TEXT;

-- No FK — by design movements reference production batches loosely so
-- deleting a batch record never orphans movements. (Audit log rows are
-- immutable by convention anyway.)
CREATE INDEX IF NOT EXISTS "stock_movements_productionBatchId_idx"
  ON "stock_movements" ("productionBatchId");
