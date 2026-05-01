'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { useT } from '@/lib/i18n/useT';
import type { DictKey } from '@/lib/i18n/dict';
import { MMK } from '@/components/i18n/MMK';

interface Props {
  data: Array<{ category: string; valueMmk: number }>;
}

const PALETTE = [
  'var(--color-primary)',
  'var(--color-accent)',
  'var(--color-success)',
  'var(--color-info)',
  'var(--color-warning)',
  'var(--color-destructive)',
  'var(--color-muted-fg)',
  'var(--color-subtle-fg)',
  '#8B5E34',
  '#D4A843',
  '#5A7A6B',
  '#7E6A91',
];

export function ValueByCategoryDonut({ data }: Props) {
  const t = useT();
  const total = data.reduce((s, r) => s + r.valueMmk, 0);
  const slices = data.map((r, i) => ({
    key: r.category,
    label: t(`mat.cat.${r.category}` as DictKey),
    value: r.valueMmk,
    color: PALETTE[i % PALETTE.length],
  }));

  return (
    <div className="card-xl" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <h3 style={{ margin: 0 }}>{t('dash.panel.valueByCategory')}</h3>
      {slices.length === 0 ? (
        <div style={{ color: 'var(--color-muted-fg)', fontSize: '0.875rem' }}>{t('common.empty')}</div>
      ) : (
        <>
          <div style={{ width: '100%', height: 200 }}>
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
                  {slices.map((s) => <Cell key={s.key} fill={s.color} />)}
                </Pie>
                <Tooltip
                  formatter={(v: number) => new Intl.NumberFormat('en-US').format(v)}
                  contentStyle={{
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--color-foreground)',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8125rem' }}>
            {slices.map((s) => {
              const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
              return (
                <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: s.color, flexShrink: 0 }} aria-hidden="true" />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
                  <span style={{ color: 'var(--color-muted-fg)' }}>{pct}%</span>
                  <span className="tabular-nums"><MMK amount={s.value} /></span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
