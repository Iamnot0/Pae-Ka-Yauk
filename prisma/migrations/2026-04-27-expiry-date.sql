-- 2026-04-27 · Per-item expiry date for finished goods.
--
-- Owner brief: Stocks page should show "N Day(s)" until expiry; Edit Stock
-- form should accept a real calendar date (dd-mm-yyyy). Storing the date
-- (not the days) keeps the displayed countdown live without a write/day.
--
-- Coexists with `shelfLifeDays` (already on the table) — that column stays
-- as a default-shelf-life hint for future "auto-set expiry on bake" work
-- (production_batches.createdAt + shelfLifeDays = expected expiry).

ALTER TABLE sellable_items
  ADD COLUMN IF NOT EXISTS "expiryDate" date;

-- No backfill: expiry is owner-entered per item; a NULL means "not tracked".
