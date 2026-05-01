'use client';

import { MMK } from '@/components/i18n/MMK';
import { useT } from '@/lib/i18n/useT';
import type { TopMaterial } from '@/lib/repos/dashboard';

/**
 * Top raw materials by inventory value (on-hand × unit cost). Mirrors the
 * TopSellingList visual language so the two cards read as a coherent pair
 * when rendered side-by-side. Bars are normalised against the leader's
 * value, not absolute, so a small bakery still shows useful relative ranks.
 *
 * `bare` mode skips the outer card + heading for use inside CollapsibleCard.
 */
export function TopMaterialsByValueList({
  data,
  bare = false,
}: {
  data: TopMaterial[];
  bare?: boolean;
}) {
  const t = useT();

  if (data.length === 0) {
    const empty = (
      <div style={{ color: 'var(--color-muted-fg)', fontSize: '0.875rem', padding: 'var(--space-3) 0' }}>
        {t('common.empty')}
      </div>
    );
    if (bare) return empty;
    return (
      <div className="card-xl">
        <h3 style={{ margin: 0, marginBottom: 'var(--space-3)', fontSize: '1.0625rem' }}>
          {t('dash.panel.topMaterials')}
        </h3>
        {empty}
      </div>
    );
  }

  const max = Math.max(...data.map((d) => d.valueMmk), 1);

  const list = (
    <ol
      style={{
        listStyle: 'none',
        padding: 0,
        margin: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        maxHeight: 320,
        overflowY: 'auto',
        paddingRight: 'var(--space-2)',
      }}
    >
      {data.map((row) => {
        const pct = Math.max((row.valueMmk / max) * 100, 4);
        return (
          <li key={row.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--space-3)', marginBottom: 4 }}>
              <span style={{ fontWeight: 500, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {row.name}
                {row.nameLocal && (
                  <span lang="my" style={{ fontSize: '0.75rem', color: 'var(--color-muted-fg)', marginLeft: 6 }}>
                    {row.nameLocal}
                  </span>
                )}
              </span>
              <span className="tabular-nums" style={{ fontSize: '0.8125rem', color: 'var(--color-muted-fg)', flexShrink: 0 }}>
                <MMK amount={row.valueMmk} />
              </span>
            </div>
            <div style={{ height: 6, background: 'var(--color-surface-alt)', borderRadius: 'var(--radius-pill)', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${pct}%`,
                  background: 'var(--color-info)',
                  borderRadius: 'inherit',
                  transition: 'width var(--transition-base)',
                }}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );

  if (bare) return list;
  return (
    <div className="card-xl">
      <h3 style={{ margin: 0, marginBottom: 'var(--space-4)', fontSize: '1.0625rem' }}>
        {t('dash.panel.topMaterials')}
      </h3>
      {list}
    </div>
  );
}
