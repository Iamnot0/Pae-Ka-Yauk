'use client';

import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, Legend } from 'recharts';
import { useT } from '@/lib/i18n/useT';

interface Props {
  data: Array<{ day: string; in: number; out: number }>;
  /** Render only the chart, no surrounding card/title. Caller (e.g.
   *  CollapsibleCard) provides its own framing. */
  bare?: boolean;
}

export function MovementTrendChart({ data, bare = false }: Props) {
  const t = useT();

  // Short axis label: MM-DD (last 5 chars of YYYY-MM-DD).
  const formatted = data.map((d) => ({ ...d, label: d.day.slice(5) }));

  const chart = (
    <div style={{ width: '100%', height: 260 }}>
        <ResponsiveContainer>
          <LineChart data={formatted} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis
              dataKey="label"
              tick={{ fill: 'var(--color-muted-fg)', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fill: 'var(--color-muted-fg)', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--color-foreground)',
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="in"  name={t('dash.trend.in')}  stroke="var(--color-success)" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="out" name={t('dash.trend.out')} stroke="var(--color-primary)" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
  );

  if (bare) return chart;

  return (
    <div className="card-xl" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <h3 style={{ margin: 0 }}>{t('dash.panel.trend30d')}</h3>
      {chart}
    </div>
  );
}
