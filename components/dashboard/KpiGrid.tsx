'use client';

import { Package, CircleDollarSign, AlertTriangle } from 'lucide-react';
import { KpiCard } from './KpiCard';
import { MMK } from '@/components/i18n/MMK';
import { useT } from '@/lib/i18n/useT';
import type { Kpis } from '@/lib/repos/dashboard';

/** Raw-material KPIs only — count, MMK value, and "low" (below par level). */
export function KpiGrid({ kpis }: { kpis: Kpis }) {
  const t = useT();
  return (
    <section
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 'var(--space-4)',
      }}
    >
      <KpiCard icon={Package}          label={t('dash.kpi.totalMaterials')} value={kpis.totalMaterials}                       tint="info" />
      <KpiCard icon={CircleDollarSign} label={t('dash.kpi.stockValue')}     value={<MMK amount={kpis.rawMaterialValueMmk} />} tint="success" />
      <KpiCard icon={AlertTriangle}    label={t('dash.kpi.lowStock')}       value={kpis.lowMaterialsCount}                    tint="warning" />
    </section>
  );
}
