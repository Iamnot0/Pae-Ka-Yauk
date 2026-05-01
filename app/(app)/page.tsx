import { requireUser } from '@/lib/auth';
import {
  getKpis,
  getStockHealth,
  getStocksHealth,
  getStocksKpis,
  getMovementTrend30d,
  getStocksMovementTrend30d,
  getSalesKpis,
  getTopSellingItems,
  getTopMaterialsByValue,
  type SalesPeriod,
} from '@/lib/repos/dashboard';
import { KpiGrid } from '@/components/dashboard/KpiGrid';
import { StocksKpiGrid } from '@/components/dashboard/StocksKpiGrid';
import { WelcomeGreeting } from '@/components/dashboard/WelcomeGreeting';
import { StockHealthDonut } from '@/components/dashboard/StockHealthDonut';
import { StocksHealthDonut } from '@/components/dashboard/StocksHealthDonut';
import { MovementTrendChart } from '@/components/dashboard/MovementTrendChart';
import { CollapsibleCard } from '@/components/dashboard/CollapsibleCard';
import { SalesKpiGrid } from '@/components/dashboard/SalesKpiGrid';
import { TopSellingList } from '@/components/dashboard/TopSellingList';
import { TopMaterialsByValueList } from '@/components/dashboard/TopMaterialsByValueList';
import { PeriodToggle } from '@/components/dashboard/PeriodToggle';
import { T } from '@/components/i18n/T';

export const dynamic = 'force-dynamic';

const VALID_PERIODS: SalesPeriod[] = ['today', 'week', 'month'];

interface PageProps {
  searchParams: Promise<{ period?: string }>;
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const user = await requireUser();
  const tenantId = user.tenantId;

  const sp = await searchParams;
  const periodRaw = sp?.period;
  const period: SalesPeriod = VALID_PERIODS.includes(periodRaw as SalesPeriod)
    ? (periodRaw as SalesPeriod)
    : 'today';

  const [
    kpis, stocksKpis, rawMatHealth, stocksHealth, rawMatTrend, stocksTrend, salesKpis, topSelling, topMaterials,
  ] = await Promise.all([
    getKpis(tenantId).catch(() => ({ totalMaterials: 0, rawMaterialValueMmk: 0, lowMaterialsCount: 0 })),
    getStocksKpis(tenantId).catch(() => ({ totalStocks: 0, lowStocksCount: 0, stocksExpiringSoonCount: 0 })),
    getStockHealth(tenantId).catch(() => ({ healthy: 0, low: 0, outOfStock: 0 })),
    getStocksHealth(tenantId).catch(() => ({ inStock: 0, low: 0, outOfStock: 0 })),
    getMovementTrend30d(tenantId).catch(() => []),
    getStocksMovementTrend30d(tenantId).catch(() => []),
    getSalesKpis(tenantId, period).catch(() => ({
      revenueMmk: 0, profitMmk: null, slipsCount: 0, itemsSold: 0, costed: 0, uncosted: 0,
    })),
    getTopSellingItems(tenantId, period, 8).catch(() => []),
    getTopMaterialsByValue(tenantId, 8).catch(() => []),
  ]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <header>
        <WelcomeGreeting userName={user.name} />
      </header>

      {/* ── Sales block — period-windowed (Today / 7d / 30d) ───────── */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 'var(--space-3)',
        }}>
          <h2 style={{ margin: 0, fontSize: '1.25rem' }}>
            <T k="dash.sales.title" />
          </h2>
          <PeriodToggle active={period} />
        </div>
        <SalesKpiGrid kpis={salesKpis} />
        {/* Two collapsible side-by-side panels: top-selling stocks (left) and
            top raw materials by value (right). Each one's body has its own
            internal scroll (maxHeight) so the cards never push the rest of
            the dashboard down. Grid auto-stacks on narrow screens. */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
            gap: 'var(--space-4)',
          }}
        >
          <CollapsibleCard title={<T k="dash.panel.topSelling" />} defaultOpen={true}>
            <TopSellingList data={topSelling} bare />
          </CollapsibleCard>
          <CollapsibleCard title={<T k="dash.panel.topMaterials" />} defaultOpen={true}>
            <TopMaterialsByValueList data={topMaterials} bare />
          </CollapsibleCard>
        </div>
      </section>

      {/* ── Stocks (finished goods) block ──────────────────────────── */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem' }}><T k="dash.section.stocks" /></h2>
        <StocksKpiGrid kpis={stocksKpis} />
      </section>

      {/* ── Raw materials block ────────────────────────────────────── */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem' }}><T k="dash.section.rawMaterials" /></h2>
        <KpiGrid kpis={kpis} />
      </section>

      {/* ── Health donuts side-by-side ─────────────────────────────── */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 'var(--space-4)',
        }}
      >
        <StocksHealthDonut data={stocksHealth} />
        <StockHealthDonut data={rawMatHealth} />
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <CollapsibleCard title={<T k="dash.panel.stocksTrend30d" />} defaultOpen={true}>
          <MovementTrendChart data={stocksTrend} bare />
        </CollapsibleCard>
        <CollapsibleCard title={<T k="dash.panel.rawMatTrend30d" />} defaultOpen={false}>
          <MovementTrendChart data={rawMatTrend} bare />
        </CollapsibleCard>
      </section>
    </div>
  );
}
