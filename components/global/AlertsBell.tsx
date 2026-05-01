'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { useT } from '@/lib/i18n/useT';

interface Alerts {
  outOfStock: Array<{ id: string; name: string; nameLocal: string | null; unit: string }>;
  lowStock: Array<{ id: string; name: string; nameLocal: string | null; unit: string; onHand: number; parLevel: number }>;
  expiring: Array<{ batchId: string; materialId: string; name: string; nameLocal: string | null; unit: string; remainingQty: number; expiryDate: string }>;
}

const EMPTY: Alerts = { outOfStock: [], lowStock: [], expiring: [] };

export function AlertsBell() {
  const t = useT();
  const [alerts, setAlerts] = useState<Alerts>(EMPTY);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/alerts', { cache: 'no-store' });
        if (!res.ok) { if (!cancelled) setErr(true); return; }
        const data = (await res.json()) as Alerts;
        if (!cancelled) setAlerts(data);
      } catch {
        if (!cancelled) setErr(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const total = alerts.outOfStock.length + alerts.lowStock.length + alerts.expiring.length;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="icon-btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t('alerts.title')}
        title={t('alerts.title')}
      >
        <Bell size={18} strokeWidth={2} />
        {total > 0 && <span className="icon-btn-badge">{total > 99 ? '99+' : total}</span>}
      </button>
      {open && (
        <div className="dropdown-panel" role="menu">
          {err ? (
            <div style={{ padding: 'var(--space-3)', color: 'var(--color-destructive)', fontSize: '0.875rem' }}>
              Unable to load alerts.
            </div>
          ) : total === 0 ? (
            <div style={{ padding: 'var(--space-3)', color: 'var(--color-muted-fg)', fontSize: '0.875rem' }}>
              {t('alerts.empty')}
            </div>
          ) : (
            <>
              {alerts.outOfStock.length > 0 && (
                <>
                  <div className="dropdown-section-label">{t('alerts.outOfStock')} ({alerts.outOfStock.length})</div>
                  {alerts.outOfStock.map((m) => (
                    <Link key={m.id} href={`/inventory/${m.id}` as unknown as never} className="dropdown-item" onClick={() => setOpen(false)}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-destructive)' }} aria-hidden="true" />
                      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                        <span style={{ fontWeight: 500 }}>{m.name}</span>
                        {m.nameLocal && <span lang="my" style={{ fontSize: '0.75rem', color: 'var(--color-muted-fg)' }}>{m.nameLocal}</span>}
                      </div>
                    </Link>
                  ))}
                </>
              )}
              {alerts.lowStock.length > 0 && (
                <>
                  <div className="dropdown-section-label">{t('alerts.lowStock')} ({alerts.lowStock.length})</div>
                  {alerts.lowStock.map((m) => (
                    <Link key={m.id} href={`/inventory/${m.id}` as unknown as never} className="dropdown-item" onClick={() => setOpen(false)}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-warning)' }} aria-hidden="true" />
                      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                        <span style={{ fontWeight: 500 }}>{m.name}</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-muted-fg)' }}>
                          {m.onHand} / {m.parLevel} {m.unit}
                        </span>
                      </div>
                    </Link>
                  ))}
                </>
              )}
              {alerts.expiring.length > 0 && (
                <>
                  <div className="dropdown-section-label">{t('alerts.expiring')} ({alerts.expiring.length})</div>
                  {alerts.expiring.map((b) => (
                    <Link key={b.batchId} href={`/inventory/${b.materialId}` as unknown as never} className="dropdown-item" onClick={() => setOpen(false)}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-info)' }} aria-hidden="true" />
                      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                        <span style={{ fontWeight: 500 }}>{b.name}</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-muted-fg)' }}>
                          {b.remainingQty} {b.unit} · {b.expiryDate}
                        </span>
                      </div>
                    </Link>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
