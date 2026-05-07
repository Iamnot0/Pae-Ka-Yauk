/**
 * GET /api/archive/{YYYY-MM}/{table}
 *
 * Returns archived rows for one (month, table) tuple as JSON. Used by
 * /historical-sales to lazy-load per-month detail when the user clicks
 * to expand a month.
 *
 * Auth: OWNER / MANAGER only — historical sales data is sensitive.
 *
 * Vercel side: returns empty unless ARCHIVE_DIR is mounted (it isn't).
 * GDrive integration is a TODO; activates when GOOGLE_SERVICE_ACCOUNT_JSON
 * is set.
 */

import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { readArchive } from '@/lib/repos/archives';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ month: string; table: string }> },
) {
  await requireRole('OWNER', 'MANAGER');
  const { month, table } = await ctx.params;
  try {
    const rows = await readArchive(month, table);
    return NextResponse.json({ month, table, rows });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }
}
