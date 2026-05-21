-- 2026-05-21 · Add discountPct column to sale_transactions.
--
-- Companion to 2026-05-21-tax-toggle-and-remove-mobile-money.sql. Applies
-- AFTER that migration. The two are split because they're independently
-- reversible (this one is cheap to drop; the tax/KBZ one is destructive).
--
-- discountTotal already exists in the schema since Sprint 4b. This migration
-- adds discountPct (the rate the cashier typed) so reports can answer
-- "show sales discounted >20%" without back-computing from amount, which
-- drifts due to rounding.
--
-- Backfill: existing rows get discountPct = 0 (historical sales had no
-- discount UI, so by definition no discount was applied). This is the
-- honest backfill (matches reality) and is non-destructive.

BEGIN;

ALTER TABLE sale_transactions
  ADD COLUMN IF NOT EXISTS "discountPct" DECIMAL(5, 2) NOT NULL DEFAULT 0;

-- Defensive: clamp any future bad data via a check constraint. Cashier UI
-- already clamps client-side, but defense-in-depth at the DB layer prevents
-- a misbehaving client from poisoning reports with negative or >100% rates.
ALTER TABLE sale_transactions
  ADD CONSTRAINT sale_transactions_discountpct_range
  CHECK ("discountPct" >= 0 AND "discountPct" <= 100);

COMMIT;
