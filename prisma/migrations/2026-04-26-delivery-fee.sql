-- Add a separate deliveryFee column on sale_transactions so the audit
-- trail can distinguish "items 5,000 + delivery 500" from "items 5,500".
-- Defaults to 0 so existing rows stay correct.
ALTER TABLE sale_transactions
  ADD COLUMN IF NOT EXISTS "deliveryFee" numeric(14,2) NOT NULL DEFAULT 0;
