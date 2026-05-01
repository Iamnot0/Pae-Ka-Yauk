-- Daily slip-ID reset (owner ask 2026-04-26):
-- Today's first sale = PKY00001. Tomorrow's first sale = PKY00001 again.
-- Past PKY00001 doesn't disappear — it's distinguished by createdAt.
--
-- Mechanism: receiptNumber is unique per (tenant, salesDate, receiptNumber),
-- where salesDate is the calendar date in Asia/Yangon. The /api/sales
-- CTE filters MAX(receiptNumber) by today's salesDate, so at 00:00 Yangon
-- the result naturally rolls back to "no rows → 0 → +1 = PKY00001".
--
-- No cron job needed — the reset is implicit in the SQL.

-- Drop the old lifetime-unique constraint (which would block PKY00001 reuse).
ALTER TABLE sale_transactions
  DROP CONSTRAINT IF EXISTS "sale_transactions_tenantId_deviceId_receiptNumber_key";

-- New unique on (tenant, Yangon-date, receiptNumber).
-- The createdAt column is `timestamp without time zone` storing UTC; the
-- AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Yangon' chain (a) marks it as UTC
-- and (b) converts to Yangon local — then ::date truncates to day boundary.
CREATE UNIQUE INDEX IF NOT EXISTS sale_transactions_daily_receipt
  ON sale_transactions (
    "tenantId",
    (("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Yangon')::date),
    "receiptNumber"
  );

-- Helper index for daily reports & the MAX(receiptNumber) CTE filter.
CREATE INDEX IF NOT EXISTS sale_transactions_tenant_yangon_date
  ON sale_transactions (
    "tenantId",
    (("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Yangon')::date)
  );
