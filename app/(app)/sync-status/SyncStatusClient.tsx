'use client';

/**
 * /sync-status interactive layer.
 *
 * Three sections:
 *   1. Drainer Health (server-side, from drainer_status on Neon)
 *   2. Recent Failures (server-side, from drainer_status.recent_failures)
 *   3. This Device (browser IndexedDB outbox via lib/client/outbox)
 *
 * Each row in (2) and (3) is a "brief" that expands to a full details panel
 * when clicked — Boss's spec was: slip ID + date + description, click → details.
 */

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, AlertTriangle, RefreshCw, ChevronDown, ChevronUp, Clock, Cloud, Database } from 'lucide-react';
import { useT } from '@/lib/i18n/useT';
import { onOutboxChange, listPending, discard, rescheduleForRetry } from '@/lib/client/outbox';
import { drainOnce } from '@/lib/client/drain';
import { summarizeOp, type OpSummary } from '@/lib/client/opSummary';
import type { PendingOp } from '@/lib/client/db';
import type { DrainerStatus, RecentFailure } from '@/lib/repos/syncStatus';

interface Props {
  initial: DrainerStatus;
  initialHealthy: boolean;
}

const TIME_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit',
  hour12: false, timeZone: 'Asia/Yangon',
});

function fmtRelativeSeconds(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function fmtDate(d: Date | string | null): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '—';
  return TIME_FORMAT.format(date);
}

export function SyncStatusClient({ initial, initialHealthy }: Props) {
  const t = useT();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [browserOps, setBrowserOps] = useState<PendingOp[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Subscribe to browser-side outbox changes; refresh list on every change.
  useEffect(() => {
    let cancelled = false;
    const reload = async () => {
      const ops = await listPending();
      if (!cancelled) setBrowserOps(ops);
    };
    void reload();
    const off = onOutboxChange(() => { void reload(); });
    return () => { cancelled = true; off(); };
  }, []);

  const toggleExpanded = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const refresh = () => startTransition(() => router.refresh());

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-4)' }}>
        <div>
          <h1 style={{ margin: 0 }}>{t('syncStatus.title')}</h1>
          <p style={{ color: 'var(--color-muted-fg)', marginTop: 4 }}>{t('syncStatus.subtitle')}</p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={refresh} aria-label={t('syncStatus.refresh')}>
          <RefreshCw size={16} /> {t('syncStatus.refresh')}
        </button>
      </header>

      <DrainerHealthCard status={initial} healthy={initialHealthy} t={t} />

      <RecentFailuresSection
        failures={initial.recentFailures}
        expanded={expanded}
        onToggle={toggleExpanded}
        t={t}
      />

      <ClientOutboxSection
        ops={browserOps}
        expanded={expanded}
        onToggle={toggleExpanded}
        t={t}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DrainerHealthCard({
  status, healthy, t,
}: { status: DrainerStatus; healthy: boolean; t: ReturnType<typeof useT> }) {
  const stateBg = healthy ? 'var(--color-success-bg)'     : 'var(--color-destructive-bg)';
  const stateFg = healthy ? 'var(--color-success)'        : 'var(--color-destructive)';
  const stateIcon = healthy ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />;

  const stalenessLabel =
    status.staleness === null
      ? t('syncStatus.drainer.never')
      : healthy
        ? t('syncStatus.drainer.healthy')
        : t('syncStatus.drainer.stale').replace('{s}', String(status.staleness));

  return (
    <section
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-4)',
        display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <Cloud size={20} />
        <h2 style={{ margin: 0, fontSize: '1.125rem' }}>{t('syncStatus.drainer.title')}</h2>
        <span
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '4px 10px', borderRadius: 'var(--radius-pill)',
            background: stateBg, color: stateFg,
            fontSize: '0.8125rem', fontWeight: 500,
          }}
        >
          {stateIcon}
          {stalenessLabel}
        </span>
      </div>
      <dl style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 'var(--space-3)', margin: 0,
      }}>
        <Stat label={t('syncStatus.drainer.lastDrain')} value={fmtDate(status.lastDrainAt)} />
        <Stat label={t('syncStatus.drainer.pending')}    value={String(status.pendingCount)} />
        <Stat label={t('syncStatus.drainer.failed')}     value={String(status.failedCount)}
              tone={status.failedCount > 0 ? 'danger' : undefined} />
        <Stat label={t('syncStatus.drainer.oldestAge')}  value={fmtRelativeSeconds(status.oldestPendingSeconds)} />
      </dl>
      {status.drainerVersion && (
        <div style={{ fontSize: '0.6875rem', color: 'var(--color-muted-fg)', fontFamily: 'var(--font-mono)' }}>
          {status.drainerVersion}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'danger' }) {
  const fg = tone === 'danger' ? 'var(--color-destructive)' : 'var(--color-fg)';
  return (
    <div>
      <dt style={{ fontSize: '0.75rem', color: 'var(--color-muted-fg)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </dt>
      <dd style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600, color: fg }}>
        {value}
      </dd>
    </div>
  );
}

function RecentFailuresSection({
  failures, expanded, onToggle, t,
}: {
  failures: RecentFailure[];
  expanded: Set<string>;
  onToggle: (key: string) => void;
  t: ReturnType<typeof useT>;
}) {
  return (
    <section
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-4)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
        <Database size={20} />
        <h2 style={{ margin: 0, fontSize: '1.125rem' }}>{t('syncStatus.failures.title')}</h2>
      </div>
      {failures.length === 0 ? (
        <p style={{ color: 'var(--color-muted-fg)', margin: 0 }}>{t('syncStatus.failures.empty')}</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {failures.map((f) => {
            const key = `srv-${f.outbox_id}`;
            const isOpen = expanded.has(key);
            return (
              <li key={key} style={{
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                padding: 'var(--space-3)',
              }}>
                <button
                  type="button"
                  onClick={() => onToggle(key)}
                  aria-expanded={isOpen}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    width: '100%', background: 'transparent', border: 'none', padding: 0,
                    color: 'inherit', textAlign: 'left', cursor: 'pointer',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 500 }}>
                      {f.table_name} · {f.op} · <span style={{ fontFamily: 'var(--font-mono)' }}>{f.row_id.slice(-8).toUpperCase()}</span>
                    </div>
                    <div style={{ fontSize: '0.8125rem', color: 'var(--color-muted-fg)' }}>
                      <Clock size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                      {fmtDate(f.occurred_at)} · {t('syncStatus.col.attempts')}: {f.attempts}
                    </div>
                  </div>
                  {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
                {isOpen && (
                  <div style={{
                    marginTop: 'var(--space-2)',
                    paddingTop: 'var(--space-2)',
                    borderTop: '1px dashed var(--color-border)',
                    fontSize: '0.8125rem',
                    display: 'grid',
                    gridTemplateColumns: 'auto 1fr',
                    gap: '6px var(--space-3)',
                  }}>
                    <span style={{ color: 'var(--color-muted-fg)' }}>Outbox ID</span>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>{f.outbox_id}</span>
                    <span style={{ color: 'var(--color-muted-fg)' }}>Row ID</span>
                    <span style={{ fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>{f.row_id}</span>
                    <span style={{ color: 'var(--color-muted-fg)' }}>{t('syncStatus.col.error')}</span>
                    <span style={{ color: 'var(--color-destructive)', wordBreak: 'break-word' }}>{f.last_error}</span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ClientOutboxSection({
  ops, expanded, onToggle, t,
}: {
  ops: PendingOp[];
  expanded: Set<string>;
  onToggle: (key: string) => void;
  t: ReturnType<typeof useT>;
}) {
  return (
    <section
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-4)',
      }}
    >
      <h2 style={{ margin: 0, fontSize: '1.125rem' }}>{t('syncStatus.client.title')}</h2>
      {ops.length === 0 ? (
        <p style={{ color: 'var(--color-muted-fg)', marginTop: 'var(--space-2)' }}>{t('syncStatus.client.empty')}</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 'var(--space-3) 0 0', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {ops.map((op) => {
            const summary = summarizeOp(op);
            const key = `cli-${op.id}`;
            const isOpen = expanded.has(key);
            return (
              <li key={key} style={{
                border: `1px solid ${op.status === 'failed' ? 'var(--color-destructive)' : 'var(--color-border)'}`,
                borderRadius: 'var(--radius-sm)',
                padding: 'var(--space-3)',
              }}>
                <button
                  type="button"
                  onClick={() => onToggle(key)}
                  aria-expanded={isOpen}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    width: '100%', background: 'transparent', border: 'none', padding: 0,
                    color: 'inherit', textAlign: 'left', cursor: 'pointer',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 500 }}>{summary.title}</div>
                    <div style={{ fontSize: '0.8125rem', color: 'var(--color-muted-fg)' }}>
                      {summary.subtitle} · <span style={{
                        color: op.status === 'failed' ? 'var(--color-destructive)' :
                               op.status === 'inflight' ? 'var(--color-warning)' :
                               'var(--color-muted-fg)',
                      }}>{op.status}</span>
                    </div>
                  </div>
                  {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
                {summary.errorMessage && (
                  <div style={{
                    marginTop: 'var(--space-2)',
                    padding: 'var(--space-2)',
                    background: 'var(--color-destructive-bg)',
                    color: 'var(--color-destructive)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.8125rem',
                  }}>
                    {summary.errorMessage}
                  </div>
                )}
                {isOpen && <DetailGrid summary={summary} op={op} t={t} />}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function DetailGrid({ summary, op, t }: { summary: OpSummary; op: PendingOp; t: ReturnType<typeof useT> }) {
  return (
    <div style={{
      marginTop: 'var(--space-2)',
      paddingTop: 'var(--space-2)',
      borderTop: '1px dashed var(--color-border)',
      display: 'flex', flexDirection: 'column', gap: 'var(--space-2)',
    }}>
      <dl style={{
        display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px var(--space-3)',
        fontSize: '0.8125rem', margin: 0,
      }}>
        {summary.details.map((d, i) => (
          <FragmentRow key={i} label={d.label} value={d.value} />
        ))}
      </dl>
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => { void rescheduleForRetry(op.id, 'manual retry', 0).then(() => drainOnce()); }}
        >
          {t('sync.panel.retry')}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => { void discard(op.id); }}
        >
          {t('sync.panel.discard')}
        </button>
      </div>
    </div>
  );
}

function FragmentRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt style={{ color: 'var(--color-muted-fg)' }}>{label}</dt>
      <dd style={{ margin: 0, fontFamily: label.includes('ID') ? 'var(--font-mono)' : undefined, wordBreak: 'break-all' }}>{value}</dd>
    </>
  );
}
