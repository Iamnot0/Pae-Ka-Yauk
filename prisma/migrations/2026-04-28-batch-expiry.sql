-- 2026-04-28 · Per-batch expiry on production_batches.
--
-- Each baking run gets its own expiry date, so a Stocks-page row reflects
-- the SOONEST-expiring batch the staff should pull from the shelf, not a
-- single per-item field that doesn't track FIFO sequencing.
--
-- Set on production:  bake.createdAt + sellable_items.shelfLifeDays
-- Set on receive:     supplier-provided / blank
-- Reads on Stocks:    MIN(production_batches.expiryDate) for that item where
--                     expiryDate >= today (we ignore already-expired batches
--                     so the table doesn't show "Expired" forever).

ALTER TABLE production_batches
  ADD COLUMN IF NOT EXISTS "expiryDate" date;

-- Index helps the soonest-expiring lookup on the Stocks page.
CREATE INDEX IF NOT EXISTS production_batches_item_expiry
  ON production_batches ("tenantId", "itemId", "expiryDate")
  WHERE "expiryDate" IS NOT NULL;
