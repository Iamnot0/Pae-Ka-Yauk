-- Catch-up migration for sellable_items.unit
--
-- Background: this column was added directly to the Neon production DB at some
-- point without a matching migration file or Prisma model field. The query in
-- lib/repos/stocks.ts:105 reads it as `i.unit AS "directUnit"`, so any fresh
-- schema (e.g. the cashier-station local Postgres on Parrot OS) crashes with
-- `column i.unit does not exist` until this column is present.
--
-- Type: text (matches the live Neon column). Nullable, no default — the
-- importer / Edit form fills it explicitly.

ALTER TABLE "sellable_items"
  ADD COLUMN IF NOT EXISTS "unit" text;
