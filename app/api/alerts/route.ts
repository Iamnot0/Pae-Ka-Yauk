import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { getStockAlerts } from '@/lib/repos/dashboard';

export async function GET() {
  const user = await requireUser();
  try {
    const alerts = await getStockAlerts(user.tenantId);
    return NextResponse.json(alerts, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    console.error('[alerts GET]', (e as Error).message);
    return NextResponse.json(
      { error: 'Failed to load alerts' },
      { status: 500 }
    );
  }
}
