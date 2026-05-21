-- 2026-05-21 · Tax toggle (opt-in per sale) + hard removal of MOBILE_MONEY tender.
--
-- BOSS-CONFIRMED IRREVERSIBLE CHANGES (twice, with full awareness):
--   1. DELETE all historical sale_transactions with tenderType='MOBILE_MONEY'
--      (and their sale_lines via FK cascade). This is destructive and cannot
--      be rolled back without a pre-migration pg_dump.
--   2. Drop MOBILE_MONEY from the TenderType enum. Cannot be re-added via the
--      provided rollback script — the rollback only re-introduces the enum
--      value; it cannot restore the deleted rows.
--
-- PRE-FLIGHT (operator must run first, manually, NOT in this script):
--   pg_dump -Fc -t sale_transactions -t sale_lines $DATABASE_URL > backup-pre-tax-toggle.dump
--   pg_dump -Fc -t sale_transactions -t sale_lines $NEON_DATABASE_URL > backup-pre-tax-toggle-neon.dump
--   Without these dumps, the destructive step is unrecoverable.
--
-- SAFE CHANGES (reversible via the rollback script):
--   3. Add sale_transactions.taxApplied (boolean, default false).
--   4. Backfill existing rows to taxApplied=false per owner instruction
--      (override the implicit historical "every slip had 5% tax" assumption
--       with "no slip actually collected tax" — accepts the receipt-vs-database
--       contradiction the owner explicitly accepted).
--
-- WRAPPED IN A SINGLE TRANSACTION so any failure rolls back all four steps
-- and leaves the database in its pre-migration state.

BEGIN;

-- (1) Delete historical MOBILE_MONEY sale lines (FK to sale_transactions).
DELETE FROM sale_lines
 WHERE "saleId" IN (
   SELECT id FROM sale_transactions WHERE "tenderType" = 'MOBILE_MONEY'
 );

-- (2) Delete historical MOBILE_MONEY sale transactions themselves.
DELETE FROM sale_transactions WHERE "tenderType" = 'MOBILE_MONEY';

-- (3) Add taxApplied column. Default false so the column NOT NULL constraint
--     holds on all existing rows immediately, no separate UPDATE needed.
ALTER TABLE sale_transactions
  ADD COLUMN IF NOT EXISTS "taxApplied" boolean NOT NULL DEFAULT false;

-- (4) Drop MOBILE_MONEY from TenderType. Postgres has no ALTER TYPE ... DROP
--     VALUE, so we rebuild the enum: rename old, create new, retype the
--     column USING text cast, drop old. The cast is safe because step (2)
--     deleted every row that referenced MOBILE_MONEY.
ALTER TYPE "TenderType" RENAME TO "TenderType_pre_mobile_money_removal";

CREATE TYPE "TenderType" AS ENUM (
  'CASH',
  'CARD',
  'BANK_TRANSFER',
  'SPLIT',
  'CREDIT'
);

ALTER TABLE sale_transactions
  ALTER COLUMN "tenderType" TYPE "TenderType"
  USING "tenderType"::text::"TenderType";

DROP TYPE "TenderType_pre_mobile_money_removal";

COMMIT;
