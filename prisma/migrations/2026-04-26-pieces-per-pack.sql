-- Pure metadata field for items sold by pack (e.g. "Soft Roll - 6 pcs/pack").
-- The CSV importer fills this from a "Pieces Per Pack" column so the owner
-- can describe pack contents in the spreadsheet. Stock math is unchanged:
-- on-hand and recipes still operate in the item's yield-unit (PCS, BOX, etc).
ALTER TABLE sellable_items
  ADD COLUMN IF NOT EXISTS "piecesPerPack" integer;
