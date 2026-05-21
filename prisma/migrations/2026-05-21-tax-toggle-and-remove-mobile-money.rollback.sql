-- 2026-05-21 · Partial rollback for tax-toggle-and-remove-mobile-money migration.
--
-- IMPORTANT: This rollback restores the SCHEMA only. It CANNOT restore the
-- historical MOBILE_MONEY sale_transactions + sale_lines that the forward
-- migration deleted. To recover those rows, restore the pg_dump backup taken
-- pre-migration:
--
--   pg_restore --data-only -t sale_transactions -t sale_lines -d $DATABASE_URL backup-pre-tax-toggle.dump
--
-- After running THIS script (which puts the enum back) AND restoring the
-- backup (which puts the rows back), the database is fully restored.

BEGIN;

-- (1) Drop the taxApplied column.
ALTER TABLE sale_transactions DROP COLUMN IF EXISTS "taxApplied";

-- (2) Restore MOBILE_MONEY enum value by rebuilding the enum the other way.
ALTER TYPE "TenderType" RENAME TO "TenderType_post_mobile_money_removal";

CREATE TYPE "TenderType" AS ENUM (
  'CASH',
  'CARD',
  'MOBILE_MONEY',
  'BANK_TRANSFER',
  'SPLIT',
  'CREDIT'
);

ALTER TABLE sale_transactions
  ALTER COLUMN "tenderType" TYPE "TenderType"
  USING "tenderType"::text::"TenderType";

DROP TYPE "TenderType_post_mobile_money_removal";

COMMIT;
