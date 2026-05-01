-- Backfill `sellable_items.sku` for every row that's still NULL.
--
-- Why: the bulk xlsx importer (scripts/_importStocksXlsx.mjs) inserted rows
-- with sku=NULL, bypassing lib/repos/items.ts → createItem (which auto-fills).
-- Result: the scanner pipeline `items.find(it => it.sku === scanCode)` silently
-- missed every scan. New items going forward get a SKU automatically; this
-- migration cleans up the existing catalog.
--
-- Method: pick a fresh 8-digit numeric per row from generate_series, skipping
-- anything already taken inside the same tenant. With ~100 items and 90M
-- candidates the assignment is single-pass.
--
-- Side effect: bumps "updatedAt" so the catalog ETag changes and the offline
-- IndexedDB cache refreshes on the next /api/catalog call.

WITH needs AS (
  SELECT id, "tenantId",
         ROW_NUMBER() OVER (PARTITION BY "tenantId" ORDER BY "createdAt", id) AS rn
  FROM sellable_items
  WHERE sku IS NULL AND "deletedAt" IS NULL
),
candidates AS (
  -- Sequential block per tenant starting at 80000001. Existing auto-generated
  -- SKUs land randomly in [10_000_000, 99_999_999], so a contiguous slab high
  -- in the range gives statistically-zero collisions.
  SELECT n.id, n.rn, n."tenantId",
         LPAD((80000000 + n.rn)::text, 8, '0') AS new_sku
  FROM needs n
)
UPDATE sellable_items s
SET sku = c.new_sku, "updatedAt" = NOW()
FROM candidates c
WHERE s.id = c.id
  -- Defensive: skip the rare collision; the row stays NULL and a re-run
  -- (with a different starting offset) can mop up. With our ranges this is
  -- never reached on a fresh tenant.
  AND NOT EXISTS (
    SELECT 1 FROM sellable_items s2
    WHERE s2."tenantId" = c."tenantId" AND s2.sku = c.new_sku AND s2.id <> c.id
  );
