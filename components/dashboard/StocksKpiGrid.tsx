'use client';

import { Boxes, AlertTriangle, Clock } from 'lucide-react';
import { KpiCard } from './KpiCard';
import { useT } from '@/lib/i18n/useT';
import type { StocksKpis } from '@/lib/repos/dashboard';

/**
 * Stocks-side (sellable_items) KPI tiles. Mirrors the raw-material row so
 * an owner can scan both at a glance.
 *
 * Low-stocks threshold is currently a constant (≤ 5 finished units) inside
 * `getStocksKpis`. Once `sellable_items.lowStockThreshold` exists this row
 * gets accurate without changing here.
 */
export function StocksKpiGrid({ kpis }: { kpis: StocksKpis }) {
  const t = useT();
  return (
    <section
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 'var(--space-4)',
      }}
    >
      <KpiCard icon={Boxes}         label={t('dash.kpi.totalStocks')} value={kpis.totalStocks}             tint="primary" />
      <KpiCard icon={AlertTriangle} label={t('dash.kpi.lowStocks')}   value={kpis.lowStocksCount}          tint="warning" />
      <KpiCard icon={Clock}         label={t('dash.kpi.expiring')}    value={kpis.stocksExpiringSoonCount} tint="destructive" />
    </section>
  );
}
