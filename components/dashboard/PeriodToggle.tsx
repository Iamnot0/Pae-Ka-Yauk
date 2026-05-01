'use client';

/**
 * Today / Last 7 days / Last 30 days pill toggle for the dashboard sales
 * block. Pure-link-based so server components can do all the data fetching
 * — clicking a pill reloads the page with ?period=... in the URL.
 */

import Link from 'next/link';
import { useT } from '@/lib/i18n/useT';
import type { DictKey } from '@/lib/i18n/dict';
import type { SalesPeriod } from '@/lib/repos/dashboard';

const PERIODS: SalesPeriod[] = ['today', 'week', 'month'];

const PERIOD_LABEL_KEY: Record<SalesPeriod, DictKey> = {
  today: 'dash.sales.period.today',
  week:  'dash.sales.period.week',
  month: 'dash.sales.period.month',
};

export function PeriodToggle({ active }: { active: SalesPeriod }) {
  const t = useT();
  return (
    <div
      role="tablist"
      aria-label="Period"
      style={{
        display: 'inline-flex',
        gap: 4,
        padding: 4,
        borderRadius: 'var(--radius-pill)',
        background: 'var(--color-surface-alt)',
        border: '1px solid var(--color-border)',
      }}
    >
      {PERIODS.map((p) => {
        const isActive = p === active;
        return (
          <Link
            key={p}
            href={`?period=${p}` as never}
            role="tab"
            aria-selected={isActive}
            style={{
              padding: '6px 14px',
              borderRadius: 'var(--radius-pill)',
              fontSize: '0.8125rem',
              fontWeight: 500,
              color: isActive ? '#fff' : 'var(--color-muted-fg)',
              background: isActive ? 'var(--color-primary)' : 'transparent',
              textDecoration: 'none',
              transition: 'background var(--transition-fast), color var(--transition-fast)',
            }}
          >
            {t(PERIOD_LABEL_KEY[p])}
          </Link>
        );
      })}
    </div>
  );
}
