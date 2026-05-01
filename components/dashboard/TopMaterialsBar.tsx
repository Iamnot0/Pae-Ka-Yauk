'use client';

import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from 'recharts';
import { useT } from '@/lib/i18n/useT';

interface Props {
  data: Array<{ id: string; name: string; nameLocal: string | null; valueMmk: number }>;
}

export function TopMaterialsBar({ data }: Props) {
  const t = useT();
  const height = Math.max(200, 32 * data.length + 40);

  return (
    <div className="card-xl" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <h3 style={{ margin: 0 }}>{t('dash.panel.topMaterials')}</h3>
      {data.length === 0 ? (
        <div style={{ color: 'var(--color-muted-fg)', fontSize: '0.875rem' }}>{t('common.empty')}</div>
      ) : (
        <div style={{ width: '100%', height }}>
          <ResponsiveContainer>
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="name"
                width={140}
                tick={{ fill: 'var(--color-foreground)', fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                formatter={(v: number) => new Intl.NumberFormat('en-US').format(v)}
                contentStyle={{
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--color-foreground)',
                }}
              />
              <Bar dataKey="valueMmk" fill="var(--color-primary)" radius={[0, 4, 4, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
