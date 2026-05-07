/**
 * /historical-sales — owner audit page for archived sales.
 *
 * The daily archive job (scripts/archiveOldSales.mjs) moves rows older than
 * 30 days into JSONL.gz files under /home/paekayauk/archive/{YYYY-MM}/. This
 * page lists those months and lets the owner expand any month to see what
 * was sold, baked, adjusted, or wasted in that window.
 *
 * Lazy-load: the month list is server-rendered (small, cheap), per-month
 * detail is fetched client-side via /api/archive/{month}/{table} when the
 * owner clicks to expand.
 */

import { requireRole } from '@/lib/auth';
import { listArchiveMonths, ARCHIVE_DIR } from '@/lib/repos/archives';
import { HistoricalSalesClient } from './HistoricalSalesClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function HistoricalSalesPage() {
  await requireRole('OWNER', 'MANAGER');
  const months = listArchiveMonths();
  return <HistoricalSalesClient months={months} archiveDir={ARCHIVE_DIR} />;
}
