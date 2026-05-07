'use client';

/**
 * SyncStatusPill — header badge that exposes the offline-first cashier's
 * outbox state at a glance. Sits next to ConnectionPill in the header.
 *
 * Four states:
 *   - Synced              (green)     0 pending + 0 failed + online
 *   - Syncing N           (amber)     N inflight
 *   - Offline · N pending (gray)      !navigator.onLine + N pending
 *   - Failed N            (red)       count(failed) > 0
 *
 * The pill subscribes to `onOutboxChange` so it refreshes instantly when
 * the drain loop resolves an op or a new write enqueues. No polling.
 *
 * Click → debug panel (OWNER role only) listing failed/pending ops with
 * Retry / Discard. Phase 2 ships a tiny floating panel; richer UX in a
 * future sprint.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, RefreshCw, WifiOff, AlertTriangle, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { useT } from '@/lib/i18n/useT';
import { onOutboxChange, listPending, countByStatus, discard, rescheduleForRetry } from '@/lib/client/outbox';
import { drainOnce } from '@/lib/client/drain';
import { summarizeOp } from '@/lib/client/opSummary';
import type { PendingOp } from '@/lib/client/db';

type Status = 'synced' | 'syncing' | 'offline' | 'failed';

interface State {
  status: Status;
  pending: number;
  inflight: number;
  failed: number;
  online: boolean;
}

const initial: State = {
  status: 'synced',
  pending: 0,
  inflight: 0,
  failed: 0,
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
};

export function SyncStatusPill({ canDebug }: { canDebug: boolean }) {
  const t = useT();
  const [state, setState] = useState<State>(initial);
  const [open, setOpen] = useState(false);
  const [ops, setOps] = useState<PendingOp[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Recompute pill state from store + navigator.onLine.
  useEffect(() => {
    let cancelled = false;
    const recompute = async () => {
      const counts = await countByStatus();
      const online = navigator.onLine;
      let status: Status = 'synced';
      if (counts.failed > 0) status = 'failed';
      else if (counts.inflight > 0) status = 'syncing';
      else if (!online && counts.pending > 0) status = 'offline';
      else if (counts.pending > 0) status = 'syncing'; // pending + online = drain about to fire
      if (!cancelled) {
        setState({ status, pending: counts.pending, inflight: counts.inflight, failed: counts.failed, online });
      }
    };
    void recompute();
    const off = onOutboxChange(() => { void recompute(); });
    const onOn = () => { void recompute(); };
    const onOff = () => { void recompute(); };
    window.addEventListener('online', onOn);
    window.addEventListener('offline', onOff);
    return () => {
      cancelled = true;
      off();
      window.removeEventListener('online', onOn);
      window.removeEventListener('offline', onOff);
    };
  }, []);

  // When the panel opens, lazy-load the op list.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void listPending().then((rows) => { if (!cancelled) setOps(rows); });
    const off = onOutboxChange(() => {
      if (!cancelled) void listPending().then((rows) => { if (!cancelled) setOps(rows); });
    });
    return () => { cancelled = true; off(); };
  }, [open]);

  const tone = TONE[state.status];
  const label = labelFor(state, t);

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => canDebug && setOpen((v) => !v)}
        aria-label={label}
        title={label}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 10px',
          borderRadius: 'var(--radius-pill)',
          background: tone.bg,
          color: tone.fg,
          border: `1px solid ${tone.border}`,
          fontSize: '0.8125rem',
          fontWeight: 500,
          cursor: canDebug ? 'pointer' : 'default',
        }}
      >
        <tone.Icon size={14} strokeWidth={2.25} className={state.status === 'syncing' ? 'spin' : ''} />
        <span>{label}</span>
      </button>
      {canDebug && open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            minWidth: 320,
            maxWidth: 480,
            maxHeight: 420,
            overflowY: 'auto',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-lg)',
            zIndex: 50,
            padding: 'var(--space-3)',
          }}
          role="dialog"
        >
          <div style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: 8 }}>
            {t('sync.panel.title')}
          </div>
          {ops.length === 0 ? (
            <div style={{ fontSize: '0.8125rem', color: 'var(--color-muted-fg)' }}>
              {t('sync.panel.empty')}
            </div>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {ops.map((op) => {
                const summary = summarizeOp(op);
                const isOpen = expanded.has(op.id);
                return (
                  <li key={op.id} style={{
                    border: `1px solid ${op.status === 'failed' ? 'var(--color-destructive)' : 'var(--color-border)'}`,
                    borderRadius: 'var(--radius-sm)',
                    padding: 'var(--space-2)',
                    fontSize: '0.8125rem',
                    display: 'flex', flexDirection: 'column', gap: 4,
                  }}>
                    <button
                      type="button"
                      onClick={() => toggleExpand(op.id)}
                      aria-expanded={isOpen}
                      aria-label={isOpen ? t('sync.panel.collapse') : t('sync.panel.expand')}
                      style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8,
                        background: 'transparent', border: 'none', padding: 0,
                        color: 'inherit', textAlign: 'left', cursor: 'pointer',
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontWeight: 500, lineHeight: 1.3 }}>{summary.title}</div>
                        <div style={{ color: 'var(--color-muted-fg)', fontSize: '0.6875rem', marginTop: 2 }}>
                          {summary.subtitle} · <span style={{ color: STATUS_FG[op.status] ?? 'var(--color-muted-fg)' }}>{op.status}</span>
                        </div>
                      </div>
                      {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                    {summary.errorMessage && (
                      <div style={{ color: 'var(--color-destructive)', fontSize: '0.6875rem', wordBreak: 'break-word' }}>
                        {summary.errorMessage}
                      </div>
                    )}
                    {isOpen && (
                      <dl style={{
                        display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px',
                        margin: 0, paddingTop: 6, borderTop: '1px dashed var(--color-border)',
                        fontSize: '0.6875rem',
                      }}>
                        {summary.details.map((d, i) => (
                          <DetailRow key={i} label={d.label} value={d.value} />
                        ))}
                      </dl>
                    )}
                    <div style={{ display: 'flex', gap: 6 }}>
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
                  </li>
                );
              })}
            </ul>
          )}
          <div style={{
            marginTop: 'var(--space-3)',
            paddingTop: 'var(--space-2)',
            borderTop: '1px solid var(--color-border)',
            textAlign: 'center',
          }}>
            <Link
              href={'/sync-status' as unknown as never}
              onClick={() => setOpen(false)}
              style={{
                fontSize: '0.75rem', color: 'var(--color-accent)',
                display: 'inline-flex', alignItems: 'center', gap: 4,
                textDecoration: 'none',
              }}
            >
              {t('sync.panel.viewAll')} <ExternalLink size={11} />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  const isMonoLabel = label.includes('ID') || label.includes('ULID');
  return (
    <>
      <dt style={{ color: 'var(--color-muted-fg)' }}>{label}</dt>
      <dd style={{
        margin: 0,
        wordBreak: 'break-all',
        fontFamily: isMonoLabel ? 'var(--font-mono)' : undefined,
      }}>
        {value}
      </dd>
    </>
  );
}

function labelFor(s: State, t: ReturnType<typeof useT>): string {
  switch (s.status) {
    case 'synced':  return t('sync.synced');
    case 'syncing': return t('sync.syncingN').replace('{n}', String(Math.max(s.inflight, s.pending)));
    case 'offline': return t('sync.offlinePending').replace('{n}', String(s.pending));
    case 'failed':  return t('sync.failedN').replace('{n}', String(s.failed));
  }
}

interface Tone {
  bg: string;
  fg: string;
  border: string;
  Icon: typeof CheckCircle2;
}

const TONE: Record<Status, Tone> = {
  synced:  { bg: 'var(--color-success-bg)',     fg: 'var(--color-success)',     border: 'var(--color-success)',    Icon: CheckCircle2 },
  syncing: { bg: 'var(--color-warning-bg)',     fg: 'var(--color-warning)',     border: 'var(--color-warning)',    Icon: RefreshCw },
  offline: { bg: 'var(--color-surface-alt)',    fg: 'var(--color-muted-fg)',    border: 'var(--color-border)',     Icon: WifiOff },
  failed:  { bg: 'var(--color-destructive-bg)', fg: 'var(--color-destructive)', border: 'var(--color-destructive)', Icon: AlertTriangle },
};

const STATUS_FG: Record<string, string> = {
  pending:  'var(--color-muted-fg)',
  inflight: 'var(--color-warning)',
  failed:   'var(--color-destructive)',
};
