-- 2026-05-21 · Rollback for discount-pct migration.
-- Drops the column and check constraint. Safe + reversible (no data loss
-- beyond the discountPct values themselves).

BEGIN;

ALTER TABLE sale_transactions
  DROP CONSTRAINT IF EXISTS sale_transactions_discountpct_range;

ALTER TABLE sale_transactions
  DROP COLUMN IF EXISTS "discountPct";

COMMIT;
