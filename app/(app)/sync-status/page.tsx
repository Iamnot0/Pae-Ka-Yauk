/**
 * /sync-status — health page for the two-tier sync architecture:
 *
 *   1. Cashier device → Parrot server (browser IndexedDB outbox)
 *   2. Parrot server → Neon cloud      (Postgres sync_outbox + drainer)
 *
 * The drainer writes a heartbeat to drainer_status every cycle. Vercel UI
 * reads it from Neon to show drainer health + recent failures in real time.
 * The local browser-side outbox surfaces in a client component below.
 */

import { requireUser } from '@/lib/auth';
import { getDrainerStatus, isDrainerHealthy, type RecentFailure } from '@/lib/repos/syncStatus';
import { SyncStatusClient } from './SyncStatusClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function SyncStatusPage() {
  await requireUser();
  const status = await getDrainerStatus();
  const healthy = isDrainerHealthy(status);
  return <SyncStatusClient initial={status} initialHealthy={healthy} />;
}

// Re-exported so the client component can type the same shape without a
// duplicate import path.
export type { DrainerStatus } from '@/lib/repos/syncStatus';
export type { RecentFailure };
