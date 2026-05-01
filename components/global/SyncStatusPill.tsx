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
import { CheckCircle2, RefreshCw, WifiOff, AlertTriangle } from 'lucide-react';
import { useT } from '@/lib/i18n/useT';
import { onOutboxChange, listPending, countByStatus, discard, rescheduleForRetry } from '@/lib/client/outbox';
import { drainOnce } from '@/lib/client/drain';
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
              {ops.map((op) => (
                <li key={op.id} style={{
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  padding: 'var(--space-2)',
                  fontSize: '0.8125rem',
                  display: 'flex', flexDirection: 'column', gap: 4,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>{op.endpoint}</span>
                    <span style={{ color: STATUS_FG[op.status] ?? 'var(--color-muted-fg)' }}>{op.status}</span>
                  </div>
                  <div style={{ color: 'var(--color-muted-fg)', fontFamily: 'var(--font-mono)', fontSize: '0.6875rem', wordBreak: 'break-all' }}>
                    {op.id}
                  </div>
                  {op.lastError && (
                    <div style={{ color: 'var(--color-destructive)', fontSize: '0.6875rem' }}>
                      {op.lastError}
                    </div>
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
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
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
