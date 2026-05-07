'use client';

/**
 * Client side of /historical-sales: month list + lazy-loaded per-month detail.
 *
 * UX: each month is a collapsible card showing total bytes archived and a
 * per-table breakdown. Click "View" → fetches /api/archive/{month}/{table}
 * and renders rows in a simple table with column auto-detection.
 */

import { useState } from 'react';
import { ChevronDown, ChevronUp, FolderArchive, FileDown } from 'lucide-react';
import { useT } from '@/lib/i18n/useT';
import type { ArchiveMonth } from '@/lib/repos/archives';

interface Props {
  months: ArchiveMonth[];
  archiveDir: string;
}

interface CachedTable {
  rows: Record<string, unknown>[];
  loading: boolean;
  error: string | null;
}

export function HistoricalSalesClient({ months, archiveDir }: Props) {
  const t = useT();
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);
  const [tableData, setTableData] = useState<Record<string, CachedTable>>({});

  const cacheKey = (month: string, table: string) => `${month}:${table}`;

  const loadTable = async (month: string, table: string) => {
    const k = cacheKey(month, table);
    if (tableData[k]?.rows && !tableData[k].error) return; // cached
    setTableData((prev) => ({ ...prev, [k]: { rows: [], loading: true, error: null } }));
    try {
      const res = await fetch(`/api/archive/${month}/${table}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as { rows: Record<string, unknown>[] };
      setTableData((prev) => ({ ...prev, [k]: { rows: json.rows, loading: false, error: null } }));
    } catch (e) {
      setTableData((prev) => ({ ...prev, [k]: { rows: [], loading: false, error: (e as Error).message } }));
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <header>
        <h1 style={{ margin: 0 }}>{t('histSales.title')}</h1>
        <p style={{ color: 'var(--color-muted-fg)', marginTop: 4 }}>
          {t('histSales.subtitle')}
        </p>
      </header>

      {months.length === 0 ? (
        <EmptyState archiveDir={archiveDir} t={t} />
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {months.map((m) => {
            const isOpen = expandedMonth === m.month;
            return (
              <li key={m.month} style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-4)',
              }}>
                <button
                  type="button"
                  onClick={() => setExpandedMonth(isOpen ? null : m.month)}
                  aria-expanded={isOpen}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    width: '100%', background: 'transparent', border: 'none', padding: 0,
                    color: 'inherit', textAlign: 'left', cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <FolderArchive size={20} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '1rem' }}>{m.month}</div>
                      <div style={{ color: 'var(--color-muted-fg)', fontSize: '0.8125rem' }}>
                        {Object.keys(m.tables).length} {t('histSales.tableCount')} · {fmtBytes(m.totalBytes)}
                      </div>
                    </div>
                  </div>
                  {isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </button>
                {isOpen && (
                  <div style={{ marginTop: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    {Object.entries(m.tables).map(([table, bytes]) => (
                      <TableSection
                        key={table}
                        month={m.month}
                        table={table}
                        bytes={bytes}
                        cached={tableData[cacheKey(m.month, table)]}
                        onLoad={() => loadTable(m.month, table)}
                        t={t}
                      />
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function TableSection({
  month, table, bytes, cached, onLoad, t,
}: {
  month: string;
  table: string;
  bytes: number;
  cached: CachedTable | undefined;
  onLoad: () => void;
  t: ReturnType<typeof useT>;
}) {
  const [open, setOpen] = useState(false);
  const onClick = () => {
    if (!open) onLoad();
    setOpen(!open);
  };
  return (
    <div style={{
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-sm)',
      padding: 'var(--space-3)',
    }}>
      <button
        type="button"
        onClick={onClick}
        aria-expanded={open}
        style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          width: '100%', background: 'transparent', border: 'none', padding: 0,
          color: 'inherit', textAlign: 'left', cursor: 'pointer',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileDown size={14} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem' }}>{table}</span>
          <span style={{ color: 'var(--color-muted-fg)', fontSize: '0.75rem' }}>{fmtBytes(bytes)}</span>
        </div>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open && (
        <div style={{ marginTop: 'var(--space-2)' }}>
          {!cached || cached.loading ? (
            <div style={{ color: 'var(--color-muted-fg)', fontSize: '0.8125rem' }}>{t('common.loading')}</div>
          ) : cached.error ? (
            <div style={{ color: 'var(--color-destructive)', fontSize: '0.8125rem' }}>{cached.error}</div>
          ) : cached.rows.length === 0 ? (
            <div style={{ color: 'var(--color-muted-fg)', fontSize: '0.8125rem' }}>{t('common.empty')}</div>
          ) : (
            <RowsTable rows={cached.rows} />
          )}
        </div>
      )}
    </div>
  );
}

function RowsTable({ rows }: { rows: Record<string, unknown>[] }) {
  // Auto-detect columns from first row keys; preserve insertion order.
  const cols = Object.keys(rows[0] ?? {});
  return (
    <div style={{ overflowX: 'auto', maxHeight: 480, overflowY: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c} style={{
                position: 'sticky', top: 0, background: 'var(--color-surface)',
                padding: '6px 8px', textAlign: 'left',
                borderBottom: '1px solid var(--color-border)',
                whiteSpace: 'nowrap', fontWeight: 600,
              }}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ borderBottom: '1px solid var(--color-border-subtle, var(--color-border))' }}>
              {cols.map((c) => (
                <td key={c} style={{
                  padding: '6px 8px', whiteSpace: 'nowrap', maxWidth: 240,
                  overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {fmtCell(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({ archiveDir, t }: { archiveDir: string; t: ReturnType<typeof useT> }) {
  return (
    <div style={{
      background: 'var(--color-surface)',
      border: '1px dashed var(--color-border)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-6)',
      textAlign: 'center',
    }}>
      <FolderArchive size={32} style={{ opacity: 0.5, marginBottom: 'var(--space-3)' }} />
      <h2 style={{ margin: 0, fontSize: '1.125rem' }}>{t('histSales.empty.title')}</h2>
      <p style={{ color: 'var(--color-muted-fg)', marginTop: 'var(--space-2)' }}>
        {t('histSales.empty.body')}
      </p>
      <p style={{ color: 'var(--color-muted-fg)', fontSize: '0.75rem', fontFamily: 'var(--font-mono)', marginTop: 'var(--space-3)' }}>
        {archiveDir}
      </p>
    </div>
  );
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function fmtCell(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}
