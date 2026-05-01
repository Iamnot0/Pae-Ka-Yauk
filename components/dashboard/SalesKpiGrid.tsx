'use client';

import { CircleDollarSign, TrendingUp, Receipt, ShoppingBag } from 'lucide-react';
import { KpiCard } from './KpiCard';
import { MMK } from '@/components/i18n/MMK';
import { useT } from '@/lib/i18n/useT';
import type { SalesKpis } from '@/lib/repos/dashboard';

/**
 * Sales KPI block — 4 cards: Revenue / Profit / Slips / Items sold.
 *
 * Avg ticket card was dropped 2026-04-28 (revenue ÷ slips is derivable
 * mentally from the other two). 4 cards lay out as 4 cols → 2+2 → 1
 * cleanly across the @media breakpoints in globals.css.
 *
 * Profit uses the same recipe-cost path /stocks does, so recipe accuracy
 * directly drives the headline number — when items lack a costed recipe
 * the grid surfaces a "covers N of M" caveat below.
 */
export function SalesKpiGrid({ kpis }: { kpis: SalesKpis }) {
  const t = useT();
  const totalLines = kpis.costed + kpis.uncosted;

  const profitValue =
    kpis.profitMmk == null
      ? <span style={{ color: 'var(--color-subtle-fg)' }}>—</span>
      : <MMK amount={kpis.profitMmk} />;

  const profitTint =
    kpis.profitMmk == null ? 'info'
      : kpis.profitMmk >= 0 ? 'success'
      : 'destructive';

  return (
    <section
      style={{
        display: 'grid',
        // 4 hard columns on desktop. The @media block in globals.css
        // collapses to 2-col under 1100px and to 1-col under 480px so
        // each card always reads naturally.
        gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
        gap: 'var(--space-3)',
        width: '100%',
      }}
      className="dash-kpi-grid"
    >
      <KpiCard icon={CircleDollarSign} label={t('dash.kpi.revenue')}   value={<MMK amount={kpis.revenueMmk} />} tint="success" />
      <KpiCard icon={TrendingUp}       label={t('dash.kpi.profit')}    value={profitValue}                      tint={profitTint} />
      <KpiCard icon={Receipt}          label={t('dash.kpi.slips')}     value={kpis.slipsCount}                  tint="primary" />
      <KpiCard icon={ShoppingBag}      label={t('dash.kpi.itemsSold')} value={Math.round(kpis.itemsSold)}       tint="info" />
      {kpis.uncosted > 0 && totalLines > 0 && (
        <div style={{
          gridColumn: '1 / -1',
          fontSize: '0.8125rem',
          color: 'var(--color-muted-fg)',
          padding: '4px 8px',
        }}>
          {t('dash.profit.uncostedNote')
            .replace('{n}', String(kpis.costed))
            .replace('{m}', String(totalLines))}
        </div>
      )}
    </section>
  );
}
