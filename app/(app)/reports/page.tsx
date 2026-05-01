import { requireUser } from '@/lib/auth';
import { getTenantBrand } from '@/lib/repos/tenants';
import {
  getTransactionsReport,
  getStockActivityReport,
  getInventorySnapshot,
  type ReportPeriod,
} from '@/lib/repos/reports';
import { ReportsView } from '@/components/reports/ReportsView';

export const dynamic = 'force-dynamic';

function parsePeriod(raw: string | string[] | undefined): ReportPeriod {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === 'daily' || v === 'monthly' ? v : 'weekly';
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period: rawPeriod } = await searchParams;
  const period = parsePeriod(rawPeriod);
  const user = await requireUser();

  const [transactions, stockActivity, inventory, brand] = await Promise.all([
    getTransactionsReport(user.tenantId, period).catch(() => ({
      summary: { revenue: 0, saleCount: 0, avgSale: 0, voidCount: 0, taxTotal: 0, deliveryFeeTotal: 0 },
      dailyRevenue: [],
      topItems: [],
      tenderMix: [],
      modeMix: [],
      recentSales: [],
      salesWithLines: [],
    })),
    getStockActivityReport(user.tenantId, period).catch(() => ({
      summary: { receivedEvents: 0, receivedQty: 0, bakedEvents: 0, bakedQty: 0, soldQty: 0, damagedQty: 0, focQty: 0 },
      dailyActivity: [],
      topMoved: [],
      fgByCategory: [],
      fgOutOfStock: [],
      adjustments: [],
    })),
    getInventorySnapshot(user.tenantId).catch(() => ({
      asOf: new Date().toISOString(),
      kpis: { totalMaterials: 0, stockValueMmk: 0, lowStockCount: 0, outOfStockCount: 0, expiringSoonCount: 0 },
      byCategory: [],
      outOfStock: [],
      lowStock: [],
      expiring: [],
    })),
    getTenantBrand(user.tenantId).catch(() => null),
  ]);

  return (
    <ReportsView
      period={period}
      transactions={transactions}
      stockActivity={stockActivity}
      inventory={inventory}
      shopName={brand?.name ?? 'Pae Ka Yauk'}
      logoUrl={brand?.logoUrl ?? null}
      userRole={user.role}
    />
  );
}
