/**
 * GET /api/sales/today — server side of the cashier's bottom panel.
 *
 * Returns this tenant's COMPLETED sale_transactions whose `createdAt`
 * falls in today's Yangon-local date. The cashier panel polls this every
 * 5s when POS is open, then merges with the local outbox (lib/client/
 * todaysSales.ts) to produce a single deduped view.
 *
 * Hard Rule #6 — every query is tenant-scoped via requireUser().
 */

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/neonHttp';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await requireUser();
  const rows = (await sql(
    `SELECT
       t.id,
       t."receiptNumber",
       t.total::float8                         AS total,
       COALESCE(SUM(l.qty), 0)::float8         AS "itemCount",
       t."tenderType"::text                    AS "tenderType",
       t."createdAt"
     FROM sale_transactions t
     LEFT JOIN sale_lines l ON l."saleId" = t.id
     WHERE t."tenantId" = $1
       AND t.status = 'COMPLETED'
       AND (t."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Yangon')::date
           = (NOW() AT TIME ZONE 'Asia/Yangon')::date
     GROUP BY t.id
     ORDER BY t."createdAt" DESC
     LIMIT 200`,
    [user.tenantId],
  )) as Array<{
    id: string;
    receiptNumber: string | null;
    total: number;
    itemCount: number;
    tenderType: string;
    createdAt: string;
  }>;

  return NextResponse.json({ rows });
}
