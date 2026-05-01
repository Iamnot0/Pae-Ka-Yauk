/**
 * GET /api/stocks?period=today|week|all
 *
 * Re-fetch endpoint for the StocksTable client when the user toggles the
 * time window. Server-side initial render uses the repo directly; this is
 * only for live re-fetches without a full page navigation.
 */

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { getStocks, type StockPeriod } from '@/lib/repos/stocks';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const user = await requireUser();
  const url = new URL(req.url);
  const raw = url.searchParams.get('period') ?? 'today';
  const period: StockPeriod =
    raw === 'today' || raw === 'week' || raw === 'all' ? raw : 'today';

  const rows = await getStocks(user.tenantId, period);
  return NextResponse.json({ rows, period });
}
