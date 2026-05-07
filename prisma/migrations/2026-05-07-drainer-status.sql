-- Drainer heartbeat — single-row table the syncDrainer.mjs daemon upserts
-- every cycle. The trigger from 2026-05-07-sync-outbox.sql isn't attached
-- to drainer_status because it would self-feedback (drainer writes its own
-- heartbeat → outbox → drainer pushes its own heartbeat → outbox …). Instead
-- this table is added directly to the synced-tables list inside the drainer
-- (SYNCED_TABLES) and the drainer issues its own UPSERT on the Neon side
-- after writing locally — bypasses the trigger to avoid the loop.
--
-- Vercel UI reads this table from Neon to surface drainer health on
-- /sync-status (last successful drain time, pending count, recent failures).

CREATE TABLE IF NOT EXISTS drainer_status (
  id                          TEXT         PRIMARY KEY,                   -- always 'singleton'
  last_drain_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_drained_count          INT          NOT NULL DEFAULT 0,
  last_failed_count           INT          NOT NULL DEFAULT 0,
  pending_count               INT          NOT NULL DEFAULT 0,
  failed_count                INT          NOT NULL DEFAULT 0,
  oldest_pending_seconds      INT,
  recent_failures             JSONB        NOT NULL DEFAULT '[]'::jsonb,
  drainer_version             TEXT,
  updated_at                  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Single row enforced by id='singleton'. Insert if missing.
INSERT INTO drainer_status (id) VALUES ('singleton')
ON CONFLICT (id) DO NOTHING;

-- The drainer connects as the paekayauk user; grant it ownership.
ALTER TABLE drainer_status OWNER TO paekayauk;
