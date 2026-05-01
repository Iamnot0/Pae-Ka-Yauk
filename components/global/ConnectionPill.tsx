'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n/useT';

type SyncState = 'online' | 'offline' | 'syncing';

/**
 * Connection status pill — the ONLY sync UI the cashier sees.
 * They never click anything; just glance at the color.
 *
 * Phase 1: reacts to navigator.onLine only (no sync queue yet).
 * Phase 5: wires to ElectricSQL sync state + pending count.
 */
export function ConnectionPill() {
  const t = useT();
  const [state, setState] = useState<SyncState>('online');
  const [pending] = useState(0); // TODO wire to Dexie queue in Sprint 5

  useEffect(() => {
    const update = () => setState(navigator.onLine ? 'online' : 'offline');
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const label =
    state === 'online' ? t('sync.online') :
    state === 'syncing' ? t('sync.syncing') :
    t('sync.offline');

  return (
    <span className={`pill pill-${state}`} role="status" aria-live="polite">
      <span className="pill-dot" aria-hidden="true" />
      {label}
      {pending > 0 && (
        <span className="tabular-nums" style={{ opacity: 0.8 }}>
          {' · '}{pending} {t('sync.pending')}
        </span>
      )}
    </span>
  );
}
