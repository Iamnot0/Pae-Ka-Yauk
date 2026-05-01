'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { useT } from '@/lib/i18n/useT';
import type { StocksHealth } from '@/lib/repos/dashboard';

/**
 * Finished-goods (stocks) health donut. Three buckets — In stock / Low / Out —
 * mirrors the raw-material donut. Low is a hard threshold (≤5 finished units)
 * for now; per-stock thresholds land when sellable_items.lowStockThreshold ships.
 */
export function StocksHealthDonut({ data }: { data: StocksHealth }) {
  const t = useT();
  const total = data.inStock + data.low + data.outOfStock;
  const slices = [
    { key: 'inStock', label: t('dash.legend.inStock'),    value: data.inStock,    color: 'var(--color-success)' },
    { key: 'low',     label: t('dash.legend.low'),        value: data.low,        color: 'var(--color-warning)' },
    { key: 'out',     label: t('dash.legend.outOfStock'), value: data.outOfStock, color: 'var(--color-destructive)' },
  ];

  return (
    <div className="card-xl" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <h3 style={{ margin: 0 }}>{t('dash.panel.stocksHealth')}</h3>
      <div style={{ position: 'relative', width: '100%', height: 200 }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="label"
              cx="50%" cy="50%"
              innerRadius={55} outerRadius={80}
              stroke="none"
              paddingAngle={2}
              isAnimationActive={false}
            >
              {slices.map((s) => (
                <Cell key={s.key} fill={s.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--color-foreground)',
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
        }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: 700 }}>{total}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-muted-fg)' }}>{t('dash.legend.totalStocks')}</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', fontSize: '0.8125rem' }}>
        {slices.map((s) => (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: s.color }} aria-hidden="true" />
            <span>{s.label} <strong>{s.value}</strong></span>
          </div>
        ))}
      </div>
    </div>
  );
}
