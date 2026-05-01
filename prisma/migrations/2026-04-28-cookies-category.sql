-- 2026-04-28 · Cookies category for sellable items.
--
-- The shop is starting to sell cookies as a distinct line. They don't slot
-- cleanly into Bread/Cake/Pastry, so we add a dedicated enum value rather
-- than overload an existing one. Owner will tag new items via the Edit Stock
-- form; existing items stay on whatever category they had.
--
-- Hot Drink / Cold Drink consolidation in this same brief is purely a
-- DISPLAY change — no enum changes needed for that, just a category-mapping
-- helper applied at the UI layer.

ALTER TYPE "ItemCategory" ADD VALUE IF NOT EXISTS 'BAKERY_COOKIES';
