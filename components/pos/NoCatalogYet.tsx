'use client';

import { RefreshCcw, WifiOff } from 'lucide-react';
import { useState } from 'react';
import { useT } from '@/lib/i18n/useT';
import { refreshCatalog } from '@/lib/client/catalog';

/**
 * First-launch offline fallback for the POS screen. Shows when:
 *   - getCatalogLocal() returned null (no IDB cache)
 *   - AND a follow-up refreshCatalog() failed (no network)
 *
 * After day-one setup it should never appear again — the IDB row sticks
 * around indefinitely. So the UX bar is "friendly + retry" not "polished".
 */
export function NoCatalogYet({ onSuccess }: { onSuccess?: () => void }) {
  const t = useT();
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onRetry = async () => {
    setRetrying(true);
    setError(null);
    try {
      const r = await refreshCatalog();
      if (r.updated || r.status === 304) onSuccess?.();
      else setError(r.errorMessage ?? 'no network');
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div
      className="card-xl"
      role="alert"
      style={{
        maxWidth: 480,
        margin: '4rem auto',
        textAlign: 'center',
        padding: 'var(--space-5)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 'var(--space-3)',
      }}
    >
      <div style={{
        width: 56, height: 56, borderRadius: '50%',
        background: 'var(--color-warning-bg)',
        color: 'var(--color-warning)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <WifiOff size={28} />
      </div>
      <h2 style={{ margin: 0, fontSize: '1.125rem' }}>{t('pos.firstLaunch.title')}</h2>
      <p style={{ margin: 0, color: 'var(--color-muted-fg)', fontSize: '0.9375rem', lineHeight: 1.5 }}>
        {t('pos.firstLaunch.body')}
      </p>
      {error && (
        <p style={{ margin: 0, color: 'var(--color-destructive)', fontSize: '0.8125rem' }}>
          {error}
        </p>
      )}
      <button
        type="button"
        className="btn btn-primary"
        onClick={onRetry}
        disabled={retrying}
      >
        <RefreshCcw size={16} />
        {retrying ? '…' : t('pos.firstLaunch.retry')}
      </button>
    </div>
  );
}
