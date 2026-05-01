-- Wipe test data per owner ask (2026-04-26):
-- Keep only `tenants`, `users`, `raw_materials`. Everything else gets
-- truncated. The owner has stocks.xlsx + recipes lined up to re-import
-- after deploy.
--
-- TRUNCATE … CASCADE handles FK chains in one atomic statement.
-- Order doesn't matter for TRUNCATE — Postgres processes the whole list
-- as a single operation.
TRUNCATE
  sale_lines,
  sale_transactions,
  stock_movements,
  stock_batches,
  stock_adjustments,
  production_batches,
  waste_entries,
  recipe_ingredients,
  recipes,
  item_modifiers,
  modifiers,
  sellable_items,
  shifts,
  outlets,
  suppliers,
  unit_conversions
CASCADE;
