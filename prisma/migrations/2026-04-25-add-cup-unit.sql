-- Add CUP to the Unit enum so drinks (Latte, Iced Coffee, etc.) can express
-- their recipe yield naturally. Owner confirmed 2026-04-25: yield units for
-- sellable menus should be count-style (PCS, BOX, CUP, PACK, BOTTLE), not
-- weight/volume units like G/KG/ML/L. Those stay valid for raw materials.
--
-- IMPORTANT: ALTER TYPE ADD VALUE must run OUTSIDE a transaction — applyMigration.mjs
-- handles this by running each statement one-by-one without BEGIN/COMMIT.

ALTER TYPE "Unit" ADD VALUE IF NOT EXISTS 'CUP';
