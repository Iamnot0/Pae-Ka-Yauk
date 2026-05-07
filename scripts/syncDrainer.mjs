#!/usr/bin/env node
/**
 * Sync drainer — pushes Parrot's local sync_outbox to Neon over HTTP.
 *
 * Architecture (one-way Parrot → Neon):
 *   1. /api/sales etc write to local Postgres on Parrot.
 *   2. AFTER triggers (see prisma/migrations/2026-05-07-sync-outbox.sql)
 *      append a row to sync_outbox in the same transaction.
 *   3. This daemon polls sync_outbox WHERE synced_at IS NULL, batches up to
 *      100 rows, applies each as INSERT/UPDATE/DELETE on Neon (idempotent
 *      via UPSERT on id), and marks synced_at locally on success.
 *
 * Wi-Fi-resilience: failures increment `attempts` + record `last_error`
 * locally; row stays unsynced. Drainer enters exponential backoff (1s → 30s
 * cap) on consecutive failure cycles, recovers automatically when network
 * returns. Outbox rows survive process restart, OS reboot, and indefinite
 * outage — the local DB is durable storage.
 *
 * Idempotency: Neon UPSERT (`ON CONFLICT (id) DO UPDATE`) means re-syncing
 * the same outbox row twice produces the same Neon state. Safe to retry.
 *
 * Run via systemd unit paekayauk-sync.service (see /etc/systemd/system/).
 *
 * Env required:
 *   DATABASE_URL         — local Parrot Postgres (postgresql://…@localhost:5432/paekayauk)
 *   NEON_DATABASE_URL    — Neon HTTP URL (postgresql://…@ep-…aws.neon.tech/…?sslmode=require)
 */

import pg from 'pg';
import { neon } from '@neondatabase/serverless';

const { Pool } = pg;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// Every operational table on Parrot replicates to Neon so the owner's remote
// view (Vercel → Neon) shows real-time KPIs, donuts, trends, and alerts —
// not just sales. Order roughly mirrors FK dependencies so re-syncs after
// outage land cleanly. The drainer respects outbox.id ASC anyway, which
// preserves write-time ordering inside any single transaction.
const SYNCED_TABLES = [
  'tenants',
  'users',
  'raw_materials',
  'sellable_items',
  'recipes',
  'recipe_ingredients',
  'modifiers',
  'item_modifiers',
  'suppliers',
  'outlets',
  'shifts',
  'unit_conversions',
  'sale_transactions',
  'sale_lines',
  'production_batches',
  'stock_adjustments',
  'stock_movements',
  'stock_batches',
  'waste_entries',
];

const BATCH_SIZE = 100;
const POLL_INTERVAL_MS = 1000;       // sub-second target when idle
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30_000;
const MAX_ERROR_LEN = 500;            // truncate stack traces in last_error

const LOCAL_URL = process.env.DATABASE_URL;
const NEON_URL = process.env.NEON_DATABASE_URL;

if (!LOCAL_URL) {
  console.error('[drainer] DATABASE_URL is required (local Parrot Postgres)');
  process.exit(1);
}
if (!NEON_URL) {
  console.error('[drainer] NEON_DATABASE_URL is required (Neon HTTP URL)');
  process.exit(1);
}

const localPool = new Pool({ connectionString: LOCAL_URL, ssl: false });
const neonSql = neon(NEON_URL);

// ---------------------------------------------------------------------------
// Upsert SQL cache — built once at startup from Neon's information_schema
// ---------------------------------------------------------------------------

const upsertSql = new Map();

async function buildUpserts() {
  for (const table of SYNCED_TABLES) {
    const rows = await neonSql(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1
       ORDER BY ordinal_position`,
      [table],
    );
    if (rows.length === 0) {
      console.warn(`[drainer] table "${table}" not present on Neon — UPSERTs to it will fail until schema is migrated`);
      continue;
    }
    const allCols = rows.map((r) => `"${r.column_name}"`);
    const updateCols = allCols.filter((c) => c !== '"id"');
    if (updateCols.length === 0) {
      // No non-id columns to update on conflict — INSERT ... ON CONFLICT DO NOTHING
      upsertSql.set(table, `
        INSERT INTO ${table}
        SELECT * FROM jsonb_populate_record(NULL::${table}, $1::jsonb)
        ON CONFLICT (id) DO NOTHING
      `.trim());
    } else {
      upsertSql.set(table, `
        INSERT INTO ${table}
        SELECT * FROM jsonb_populate_record(NULL::${table}, $1::jsonb)
        ON CONFLICT (id) DO UPDATE
        SET (${updateCols.join(', ')}) = (${updateCols.map((c) => `EXCLUDED.${c}`).join(', ')})
      `.trim());
    }
  }
  console.log(`[drainer] cached upsert SQL for ${upsertSql.size}/${SYNCED_TABLES.length} tables`);
}

// ---------------------------------------------------------------------------
// Apply one outbox row to Neon
// ---------------------------------------------------------------------------

async function applyToNeon(row) {
  if (!SYNCED_TABLES.includes(row.table_name)) {
    throw new Error(`refusing to sync unlisted table: ${row.table_name}`);
  }

  if (row.op === 'DELETE') {
    await neonSql(
      `DELETE FROM ${row.table_name} WHERE id = $1`,
      [row.row_id],
    );
    return;
  }

  const sql = upsertSql.get(row.table_name);
  if (!sql) {
    throw new Error(`no upsert SQL cached for ${row.table_name} — table missing on Neon?`);
  }
  await neonSql(sql, [JSON.stringify(row.payload)]);
}

// ---------------------------------------------------------------------------
// Drain one batch
// ---------------------------------------------------------------------------

async function drainBatch() {
  const fetched = await localPool.query(
    `SELECT id, table_name, row_id, op, payload, attempts
     FROM sync_outbox
     WHERE synced_at IS NULL
     ORDER BY id
     LIMIT $1`,
    [BATCH_SIZE],
  );

  if (fetched.rows.length === 0) return { drained: 0, failed: 0 };

  const synced = [];
  const failed = [];

  for (const row of fetched.rows) {
    try {
      await applyToNeon(row);
      synced.push(row.id);
    } catch (e) {
      const msg = String(e?.message ?? e).slice(0, MAX_ERROR_LEN);
      console.error(`[drainer] outbox=${row.id} table=${row.table_name} op=${row.op}: ${msg}`);
      failed.push({ id: row.id, err: msg });
    }
  }

  if (synced.length > 0) {
    await localPool.query(
      `UPDATE sync_outbox SET synced_at = NOW() WHERE id = ANY($1::bigint[])`,
      [synced],
    );
  }

  for (const f of failed) {
    await localPool.query(
      `UPDATE sync_outbox SET attempts = attempts + 1, last_error = $1 WHERE id = $2`,
      [f.err, f.id],
    );
  }

  return { drained: synced.length, failed: failed.length };
}

// ---------------------------------------------------------------------------
// Drainer heartbeat — writes a single-row health snapshot to drainer_status
// on local Postgres + pushes the same row directly to Neon (bypassing the
// outbox; otherwise the heartbeat would feedback-loop through itself).
// Vercel UI reads from Neon's drainer_status to know the drainer is alive.
// ---------------------------------------------------------------------------

const DRAINER_VERSION = 'v1-2026-05-07';
const RECENT_FAILURES_LIMIT = 10;

async function writeHeartbeat(lastDrained, lastFailed) {
  const stats = await localPool.query(`
    SELECT
      COUNT(*) FILTER (WHERE synced_at IS NULL)                                                       AS pending_count,
      COUNT(*) FILTER (WHERE synced_at IS NULL AND last_error IS NOT NULL)                            AS failed_count,
      COALESCE(EXTRACT(EPOCH FROM (NOW() - MIN(occurred_at) FILTER (WHERE synced_at IS NULL))), 0)::int AS oldest_pending_seconds
    FROM sync_outbox
  `);
  const recent = await localPool.query(`
    SELECT id, table_name, row_id, op, attempts, last_error, occurred_at
    FROM sync_outbox
    WHERE synced_at IS NULL AND last_error IS NOT NULL
    ORDER BY id DESC
    LIMIT $1
  `, [RECENT_FAILURES_LIMIT]);

  const row = stats.rows[0];
  const recentJson = JSON.stringify(recent.rows.map((r) => ({
    outbox_id:   String(r.id),
    table_name:  r.table_name,
    row_id:      r.row_id,
    op:          r.op,
    attempts:    r.attempts,
    last_error:  r.last_error,
    occurred_at: r.occurred_at,
  })));

  // Local upsert
  await localPool.query(`
    INSERT INTO drainer_status
      (id, last_drain_at, last_drained_count, last_failed_count,
       pending_count, failed_count, oldest_pending_seconds, recent_failures,
       drainer_version, updated_at)
    VALUES ('singleton', NOW(), $1, $2, $3, $4, $5, $6::jsonb, $7, NOW())
    ON CONFLICT (id) DO UPDATE
    SET last_drain_at          = EXCLUDED.last_drain_at,
        last_drained_count     = EXCLUDED.last_drained_count,
        last_failed_count      = EXCLUDED.last_failed_count,
        pending_count          = EXCLUDED.pending_count,
        failed_count           = EXCLUDED.failed_count,
        oldest_pending_seconds = EXCLUDED.oldest_pending_seconds,
        recent_failures        = EXCLUDED.recent_failures,
        drainer_version        = EXCLUDED.drainer_version,
        updated_at             = EXCLUDED.updated_at
  `, [lastDrained, lastFailed, row.pending_count, row.failed_count, row.oldest_pending_seconds, recentJson, DRAINER_VERSION]);

  // Direct push to Neon (skip outbox — would feedback-loop). Best-effort:
  // failure here doesn't block draining real data; we just lose this beat.
  try {
    await neonSql(`
      INSERT INTO drainer_status
        (id, last_drain_at, last_drained_count, last_failed_count,
         pending_count, failed_count, oldest_pending_seconds, recent_failures,
         drainer_version, updated_at)
      VALUES ('singleton', NOW(), $1, $2, $3, $4, $5, $6::jsonb, $7, NOW())
      ON CONFLICT (id) DO UPDATE
      SET last_drain_at          = EXCLUDED.last_drain_at,
          last_drained_count     = EXCLUDED.last_drained_count,
          last_failed_count      = EXCLUDED.last_failed_count,
          pending_count          = EXCLUDED.pending_count,
          failed_count           = EXCLUDED.failed_count,
          oldest_pending_seconds = EXCLUDED.oldest_pending_seconds,
          recent_failures        = EXCLUDED.recent_failures,
          drainer_version        = EXCLUDED.drainer_version,
          updated_at             = EXCLUDED.updated_at
    `, [lastDrained, lastFailed, row.pending_count, row.failed_count, row.oldest_pending_seconds, recentJson, DRAINER_VERSION]);
  } catch (e) {
    console.warn('[drainer] heartbeat push to Neon failed (non-fatal):', e?.message ?? e);
  }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let running = true;
process.on('SIGTERM', () => { console.log('[drainer] SIGTERM received, draining final batch then exiting'); running = false; });
process.on('SIGINT',  () => { console.log('[drainer] SIGINT received, exiting');  running = false; });

async function main() {
  console.log('[drainer] starting');
  console.log(`[drainer] local: ${redact(LOCAL_URL)}`);
  console.log(`[drainer] neon:  ${redact(NEON_URL)}`);

  // Health check both ends before entering the loop
  await localPool.query('SELECT 1');
  console.log('[drainer] local Postgres OK');
  await neonSql('SELECT 1');
  console.log('[drainer] Neon HTTP OK');

  await buildUpserts();

  let backoff = 0;
  let consecutiveFailureCycles = 0;

  let lastHeartbeatAt = 0;
  const HEARTBEAT_INTERVAL_MS = 5_000;

  while (running) {
    try {
      const { drained, failed } = await drainBatch();

      if (drained > 0 || failed > 0) {
        console.log(`[drainer] cycle: drained=${drained} failed=${failed}`);
      }

      // Heartbeat — write at most every 5s to avoid hammering Neon when idle.
      // Always write immediately if there was activity this cycle.
      const now = Date.now();
      if (drained > 0 || failed > 0 || now - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
        try {
          await writeHeartbeat(drained, failed);
          lastHeartbeatAt = now;
        } catch (e) {
          console.warn('[drainer] heartbeat write failed (non-fatal):', e?.message ?? e);
        }
      }

      if (failed > 0) {
        consecutiveFailureCycles += 1;
        backoff = Math.min(BACKOFF_MAX_MS, (backoff || BACKOFF_BASE_MS) * 2);
        console.warn(`[drainer] backing off ${backoff}ms after ${consecutiveFailureCycles} failure cycle(s)`);
        await sleep(backoff);
      } else {
        consecutiveFailureCycles = 0;
        backoff = 0;
        if (drained === 0) {
          await sleep(POLL_INTERVAL_MS);
        }
        // drained > 0 → loop immediately, more rows likely waiting
      }
    } catch (e) {
      consecutiveFailureCycles += 1;
      backoff = Math.min(BACKOFF_MAX_MS, (backoff || BACKOFF_BASE_MS) * 2);
      console.error('[drainer] cycle error:', e?.message ?? e);
      await sleep(backoff);
    }
  }

  await localPool.end();
  console.log('[drainer] stopped cleanly');
  process.exit(0);
}

function redact(url) {
  return url.replace(/(:)[^@/]+(@)/, '$1***$2');
}

main().catch((e) => {
  console.error('[drainer] fatal:', e);
  process.exit(1);
});
