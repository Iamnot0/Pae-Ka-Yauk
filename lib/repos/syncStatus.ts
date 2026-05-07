/**
 * Server-side repo for the /sync-status page.
 *
 * Reads from drainer_status — a single-row health snapshot the drainer
 * daemon maintains on the cashier station and pushes directly to Neon
 * each cycle (bypassing sync_outbox to avoid feedback loops).
 *
 * Returns a fully-typed shape the page can render without further parsing.
 */

import { sql } from '@/lib/neonHttp';

export interface RecentFailure {
  outbox_id: string;
  table_name: string;
  row_id: string;
  op: 'INSERT' | 'UPDATE' | 'DELETE';
  attempts: number;
  last_error: string;
  occurred_at: string;
}

export interface DrainerStatus {
  /** When the drainer last completed a poll cycle (NULL if never) */
  lastDrainAt: Date | null;
  /** How many rows the drainer pushed in its last cycle */
  lastDrainedCount: number;
  /** How many rows failed in its last cycle */
  lastFailedCount: number;
  /** Currently unsynced rows in sync_outbox on the cashier station */
  pendingCount: number;
  /** Of those, how many have last_error set (drainer tried + failed) */
  failedCount: number;
  /** Age of the oldest unsynced row, in seconds */
  oldestPendingSeconds: number | null;
  /** Last 10 unsynced+failed rows (for the failures table on /sync-status) */
  recentFailures: RecentFailure[];
  /** drainer build identifier (helps confirm the right binary is running) */
  drainerVersion: string | null;
  /** When the drainer last wrote this row */
  updatedAt: Date | null;
  /** Seconds since the last heartbeat — derived field for UI */
  staleness: number | null;
}

const STALE_THRESHOLD_SECONDS = 30;

export async function getDrainerStatus(): Promise<DrainerStatus> {
  const rows = (await sql(
    `SELECT
       last_drain_at,
       last_drained_count,
       last_failed_count,
       pending_count,
       failed_count,
       oldest_pending_seconds,
       recent_failures,
       drainer_version,
       updated_at
     FROM drainer_status
     WHERE id = 'singleton'`,
  )) as Array<{
    last_drain_at: string | null;
    last_drained_count: number;
    last_failed_count: number;
    pending_count: number;
    failed_count: number;
    oldest_pending_seconds: number | null;
    recent_failures: RecentFailure[] | string;
    drainer_version: string | null;
    updated_at: string | null;
  }>;

  const row = rows[0];
  if (!row) {
    return {
      lastDrainAt: null,
      lastDrainedCount: 0,
      lastFailedCount: 0,
      pendingCount: 0,
      failedCount: 0,
      oldestPendingSeconds: null,
      recentFailures: [],
      drainerVersion: null,
      updatedAt: null,
      staleness: null,
    };
  }

  const updatedAt = row.updated_at ? new Date(row.updated_at) : null;
  const staleness = updatedAt ? Math.floor((Date.now() - updatedAt.getTime()) / 1000) : null;

  // recent_failures is JSONB; some pg drivers return it parsed, others as string.
  let recentFailures: RecentFailure[] = [];
  if (Array.isArray(row.recent_failures)) {
    recentFailures = row.recent_failures;
  } else if (typeof row.recent_failures === 'string') {
    try {
      recentFailures = JSON.parse(row.recent_failures) as RecentFailure[];
    } catch {
      recentFailures = [];
    }
  }

  return {
    lastDrainAt: row.last_drain_at ? new Date(row.last_drain_at) : null,
    lastDrainedCount: row.last_drained_count,
    lastFailedCount: row.last_failed_count,
    pendingCount: row.pending_count,
    failedCount: row.failed_count,
    oldestPendingSeconds: row.oldest_pending_seconds,
    recentFailures,
    drainerVersion: row.drainer_version,
    updatedAt,
    staleness,
  };
}

export function isDrainerHealthy(s: DrainerStatus): boolean {
  return s.staleness !== null && s.staleness <= STALE_THRESHOLD_SECONDS;
}
