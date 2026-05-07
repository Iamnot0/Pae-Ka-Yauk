-- Transactional Outbox for one-way Parrot → Neon sync
--
-- Pattern: every INSERT/UPDATE/DELETE on a synced table fires an AFTER trigger
-- in the same transaction, appending a row to sync_outbox. The drainer daemon
-- reads sync_outbox and pushes to Neon. Because the outbox row commits or
-- rolls back atomically with the source row, no sale can be lost mid-sync.

CREATE TABLE IF NOT EXISTS sync_outbox (
  id           BIGSERIAL    PRIMARY KEY,
  table_name   TEXT         NOT NULL,
  row_id       TEXT         NOT NULL,
  op           TEXT         NOT NULL CHECK (op IN ('INSERT', 'UPDATE', 'DELETE')),
  payload      JSONB        NOT NULL,
  occurred_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  attempts     INT          NOT NULL DEFAULT 0,
  last_error   TEXT,
  synced_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sync_outbox_unsynced
  ON sync_outbox (id)
  WHERE synced_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sync_outbox_table_row
  ON sync_outbox (table_name, row_id);


CREATE OR REPLACE FUNCTION sync_outbox_capture() RETURNS trigger AS $$
DECLARE
  v_row_id  TEXT;
  v_payload JSONB;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    v_row_id  := OLD.id;
    v_payload := to_jsonb(OLD);
  ELSE
    v_row_id  := NEW.id;
    v_payload := to_jsonb(NEW);
  END IF;

  INSERT INTO sync_outbox (table_name, row_id, op, payload)
  VALUES (TG_TABLE_NAME, v_row_id, TG_OP, v_payload);

  IF (TG_OP = 'DELETE') THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;


-- Attach AFTER triggers to every operational table. Idempotent: drop-then-create.
--
-- Why all 19 tables (every table except sync_outbox itself): the owner's
-- remote view served by Vercel reads from Neon, not from the Parrot LAN.
-- For the dashboard's KPIs, donuts, trends, alerts, and reports to mirror
-- reality, every table that changes during the shop's day must replicate.
-- Junction tables (item_modifiers) and lookup tables (unit_conversions) are
-- included since they have a single `id` column and rarely change anyway.

DROP TRIGGER IF EXISTS trg_outbox_tenants             ON tenants;
DROP TRIGGER IF EXISTS trg_outbox_users               ON users;
DROP TRIGGER IF EXISTS trg_outbox_raw_materials       ON raw_materials;
DROP TRIGGER IF EXISTS trg_outbox_sellable_items      ON sellable_items;
DROP TRIGGER IF EXISTS trg_outbox_recipes             ON recipes;
DROP TRIGGER IF EXISTS trg_outbox_recipe_ingredients  ON recipe_ingredients;
DROP TRIGGER IF EXISTS trg_outbox_modifiers           ON modifiers;
DROP TRIGGER IF EXISTS trg_outbox_item_modifiers      ON item_modifiers;
DROP TRIGGER IF EXISTS trg_outbox_suppliers           ON suppliers;
DROP TRIGGER IF EXISTS trg_outbox_outlets             ON outlets;
DROP TRIGGER IF EXISTS trg_outbox_shifts              ON shifts;
DROP TRIGGER IF EXISTS trg_outbox_unit_conversions    ON unit_conversions;
DROP TRIGGER IF EXISTS trg_outbox_sale_transactions   ON sale_transactions;
DROP TRIGGER IF EXISTS trg_outbox_sale_lines          ON sale_lines;
DROP TRIGGER IF EXISTS trg_outbox_production_batches  ON production_batches;
DROP TRIGGER IF EXISTS trg_outbox_stock_adjustments   ON stock_adjustments;
DROP TRIGGER IF EXISTS trg_outbox_stock_movements     ON stock_movements;
DROP TRIGGER IF EXISTS trg_outbox_stock_batches       ON stock_batches;
DROP TRIGGER IF EXISTS trg_outbox_waste_entries       ON waste_entries;

CREATE TRIGGER trg_outbox_tenants             AFTER INSERT OR UPDATE OR DELETE ON tenants             FOR EACH ROW EXECUTE FUNCTION sync_outbox_capture();
CREATE TRIGGER trg_outbox_users               AFTER INSERT OR UPDATE OR DELETE ON users               FOR EACH ROW EXECUTE FUNCTION sync_outbox_capture();
CREATE TRIGGER trg_outbox_raw_materials       AFTER INSERT OR UPDATE OR DELETE ON raw_materials       FOR EACH ROW EXECUTE FUNCTION sync_outbox_capture();
CREATE TRIGGER trg_outbox_sellable_items      AFTER INSERT OR UPDATE OR DELETE ON sellable_items      FOR EACH ROW EXECUTE FUNCTION sync_outbox_capture();
CREATE TRIGGER trg_outbox_recipes             AFTER INSERT OR UPDATE OR DELETE ON recipes             FOR EACH ROW EXECUTE FUNCTION sync_outbox_capture();
CREATE TRIGGER trg_outbox_recipe_ingredients  AFTER INSERT OR UPDATE OR DELETE ON recipe_ingredients  FOR EACH ROW EXECUTE FUNCTION sync_outbox_capture();
CREATE TRIGGER trg_outbox_modifiers           AFTER INSERT OR UPDATE OR DELETE ON modifiers           FOR EACH ROW EXECUTE FUNCTION sync_outbox_capture();
CREATE TRIGGER trg_outbox_item_modifiers      AFTER INSERT OR UPDATE OR DELETE ON item_modifiers      FOR EACH ROW EXECUTE FUNCTION sync_outbox_capture();
CREATE TRIGGER trg_outbox_suppliers           AFTER INSERT OR UPDATE OR DELETE ON suppliers           FOR EACH ROW EXECUTE FUNCTION sync_outbox_capture();
CREATE TRIGGER trg_outbox_outlets             AFTER INSERT OR UPDATE OR DELETE ON outlets             FOR EACH ROW EXECUTE FUNCTION sync_outbox_capture();
CREATE TRIGGER trg_outbox_shifts              AFTER INSERT OR UPDATE OR DELETE ON shifts              FOR EACH ROW EXECUTE FUNCTION sync_outbox_capture();
CREATE TRIGGER trg_outbox_unit_conversions    AFTER INSERT OR UPDATE OR DELETE ON unit_conversions    FOR EACH ROW EXECUTE FUNCTION sync_outbox_capture();
CREATE TRIGGER trg_outbox_sale_transactions   AFTER INSERT OR UPDATE OR DELETE ON sale_transactions   FOR EACH ROW EXECUTE FUNCTION sync_outbox_capture();
CREATE TRIGGER trg_outbox_sale_lines          AFTER INSERT OR UPDATE OR DELETE ON sale_lines          FOR EACH ROW EXECUTE FUNCTION sync_outbox_capture();
CREATE TRIGGER trg_outbox_production_batches  AFTER INSERT OR UPDATE OR DELETE ON production_batches  FOR EACH ROW EXECUTE FUNCTION sync_outbox_capture();
CREATE TRIGGER trg_outbox_stock_adjustments   AFTER INSERT OR UPDATE OR DELETE ON stock_adjustments   FOR EACH ROW EXECUTE FUNCTION sync_outbox_capture();
CREATE TRIGGER trg_outbox_stock_movements     AFTER INSERT OR UPDATE OR DELETE ON stock_movements     FOR EACH ROW EXECUTE FUNCTION sync_outbox_capture();
CREATE TRIGGER trg_outbox_stock_batches       AFTER INSERT OR UPDATE OR DELETE ON stock_batches       FOR EACH ROW EXECUTE FUNCTION sync_outbox_capture();
CREATE TRIGGER trg_outbox_waste_entries       AFTER INSERT OR UPDATE OR DELETE ON waste_entries       FOR EACH ROW EXECUTE FUNCTION sync_outbox_capture();
