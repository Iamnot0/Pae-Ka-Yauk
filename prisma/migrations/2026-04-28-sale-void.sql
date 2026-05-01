-- 2026-04-28 · Sale void with compensating ledger.
--
-- Today voiding only flips status='VOIDED'. Stock isn't returned, raw
-- materials aren't re-credited, and there's no audit of WHO voided WHEN.
-- This migration adds the missing pieces:
--
--   sale_transactions.voidedAt   — when the void happened
--   sale_transactions.voidedBy   — which user voided it
--   MovementReason 'SALE_VOID'   — distinct from SALE so reports can split
--                                  out compensating movements from real ones

ALTER TABLE sale_transactions
  ADD COLUMN IF NOT EXISTS "voidedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "voidedBy" text;

ALTER TYPE "MovementReason" ADD VALUE IF NOT EXISTS 'SALE_VOID';
