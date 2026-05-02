-- Fix to 2026-04-26-daily-receipt-reset.sql.
--
-- That migration tried to drop the old lifetime-unique receipt-number key
-- with `ALTER TABLE … DROP CONSTRAINT IF EXISTS`, but in init.sql the key
-- is created as `CREATE UNIQUE INDEX`, not as a CONSTRAINT. The DROP
-- silently no-op'd, leaving the old index in place. Result: every new
-- sale on the cashier station fails with
--   duplicate key value violates unique constraint
--   "sale_transactions_tenantId_deviceId_receiptNumber_key"
-- the moment receiptNumber recurs across days.
--
-- This migration drops the old INDEX. The (tenant, Yangon-date,
-- receiptNumber) unique index from the prior migration stays as the
-- new authority.

DROP INDEX IF EXISTS "sale_transactions_tenantId_deviceId_receiptNumber_key";
