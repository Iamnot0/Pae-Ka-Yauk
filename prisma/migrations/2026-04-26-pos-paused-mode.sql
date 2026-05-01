-- Tenant-wide inventory mode policy
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS "inventoryMode" text NOT NULL DEFAULT 'POS_PAUSED'
  CHECK ("inventoryMode" IN ('POS_PAUSED', 'FULL'));

-- Owner-entered cost per piece (used in PAUSED; fallback in FULL)
ALTER TABLE sellable_items
  ADD COLUMN IF NOT EXISTS "manualCost" numeric(14,2);

-- Note: stock_adjustments.reason is a plain text column (not a Postgres enum),
-- so RECEIVED is allowed by default. The Prisma-side AdjustmentReason enum
-- (DMG | FOC | RECEIVED) is type-safety only; no DB ALTER TYPE needed.

-- Audit trail: which mode was active when each sale was rung
ALTER TABLE sale_transactions
  ADD COLUMN IF NOT EXISTS "modeAtCreation" text
  CHECK ("modeAtCreation" IS NULL OR "modeAtCreation" IN ('POS_PAUSED', 'FULL'));

-- production_batches becomes the universal "stock-in" event log
ALTER TABLE production_batches ALTER COLUMN "recipeId" DROP NOT NULL;
ALTER TABLE production_batches
  ADD COLUMN IF NOT EXISTS "source" text NOT NULL DEFAULT 'BAKED'
  CHECK ("source" IN ('BAKED', 'RECEIVED'));
