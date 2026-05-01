'use client';

import { MMK } from '@/components/i18n/MMK';
import { useT } from '@/lib/i18n/useT';
import type { TopSellingItem } from '@/lib/repos/dashboard';

/**
 * Top-selling stocks for the active period. Horizontal-bar style — each
 * row's filled width is normalised against the leader's qty so the eye
 * can rank visually without needing a real chart library.
 *
 * `bare` mode skips the outer card + heading — pass true when wrapping in
 * CollapsibleCard or any external chrome that already supplies them.
 */
export function TopSellingList({ data, bare = false }: { data: TopSellingItem[]; bare?: boolean }) {
  const t = useT();

  if (data.length === 0) {
    const empty = (
      <div style={{ color: 'var(--color-muted-fg)', fontSize: '0.875rem', padding: 'var(--space-3) 0' }}>
        {t('dash.empty.noSales')}
      </div>
    );
    if (bare) return empty;
    return (
      <div className="card-xl">
        <h3 style={{ margin: 0, marginBottom: 'var(--space-3)', fontSize: '1.0625rem' }}>
          {t('dash.panel.topSelling')}
        </h3>
        {empty}
      </div>
    );
  }

  const max = Math.max(...data.map((d) => d.qty), 1);

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
          const pct = Math.max((row.qty / max) * 100, 4);
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
                  {Math.round(row.qty)} · <MMK amount={row.revenueMmk} />
                </span>
              </div>
              <div style={{ height: 6, background: 'var(--color-surface-alt)', borderRadius: 'var(--radius-pill)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${pct}%`,
                  background: 'var(--color-primary)',
                  borderRadius: 'inherit',
                  transition: 'width var(--transition-base)',
                }} />
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
        {t('dash.panel.topSelling')}
      </h3>
      {list}
    </div>
  );
}
