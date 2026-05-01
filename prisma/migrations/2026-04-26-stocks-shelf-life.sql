-- Per-finished-good shelf life. Display-only at first; powers the
-- "Stocks expiring ≤ 7 days" KPI on the dashboard via the join
--   production_batches.createdAt + shelfLifeDays * INTERVAL '1 day'
-- so a 1-day soft cake bake on Monday flags by Tuesday.
ALTER TABLE sellable_items
  ADD COLUMN IF NOT EXISTS "shelfLifeDays" integer;

COMMENT ON COLUMN sellable_items."shelfLifeDays" IS
  'Per-stock shelf life in days. NULL = no expiry tracking.';
