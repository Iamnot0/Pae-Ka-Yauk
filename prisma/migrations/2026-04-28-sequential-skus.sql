-- Renumber every sellable_items.sku to a sequential 8-digit value per tenant.
--
-- After this migration:
--   - First-created item per tenant  → 10000001
--   - Second item                    → 10000002
--   - Nth item                       → 10000000 + N
--
-- Why: sequential SKUs are easier for staff to scan-test, easier to reason
-- about, and grow predictably ("next item = 10000092"). The previous random
-- 8-digit scheme leaked allocation order randomness into production.
--
-- Idempotent: re-running re-emits the same numbers because ROW_NUMBER over
-- (createdAt, id) is deterministic. Soft-deleted rows are excluded; their
-- (now stale) SKU stays untouched and they don't enter the active sequence.
--
-- WARNING: any printed sticker carrying an old random SKU will no longer
-- match its item after this migration. Reprint stickers as needed.

WITH ordered AS (
  SELECT id, "tenantId",
         ROW_NUMBER() OVER (PARTITION BY "tenantId" ORDER BY "createdAt", id) AS rn
  FROM sellable_items
  WHERE "deletedAt" IS NULL
)
UPDATE sellable_items s
SET sku        = LPAD((10000000 + o.rn)::text, 8, '0'),
    "updatedAt" = NOW()
FROM ordered o
WHERE s.id = o.id;
