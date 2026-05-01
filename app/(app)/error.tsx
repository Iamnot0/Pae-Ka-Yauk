'use client';

/**
 * Route-group error boundary for authenticated app routes.
 *
 * Catches any uncaught error thrown from a page, layout, or Server Component
 * within (app)/*. Most frequent cause in this codebase is Neon HTTP driver
 * exhausting its 4-retry budget on a cold-start wake-up (~3s). In that case
 * the user's session is still valid — we just couldn't load the data this
 * render. Retry triggers a fresh request; Neon is usually warm by then.
 */

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, RefreshCcw, Home } from 'lucide-react';
import { useT } from '@/lib/i18n/useT';

function isDbReachabilityError(message: string): boolean {
  const msg = message.toLowerCase();
  return (
    msg.includes('fetch failed') ||
    msg.includes('etimedout') ||
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('compute is suspended') ||
    msg.includes('endpoint is disabled')
  );
}

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT();
  const isDb = isDbReachabilityError(error.message);

  useEffect(() => {
    // Surface the raw error to the dev console for easier debugging.
    // In production this is harmless — the user only sees the friendly card.
    console.error('[app/error-boundary]', error);
  }, [error]);

  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-6) var(--space-4)' }}>
      <div
        className="card-xl"
        role="alert"
        style={{
          maxWidth: 520,
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-4)',
          alignItems: 'flex-start',
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: 56,
            height: 56,
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-destructive-bg)',
            color: 'var(--color-destructive)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <AlertTriangle size={28} strokeWidth={2} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <h1 style={{ margin: 0, fontSize: '1.5rem', lineHeight: 1.2 }}>{t('error.title')}</h1>
          <p style={{ margin: 0, color: 'var(--color-muted-fg)', lineHeight: 1.5 }}>
            {isDb ? t('error.dbUnreachable') : t('error.generic')}
          </p>
          {error.digest && (
            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-subtle-fg)' }}>
              Ref: <code>{error.digest}</code>
            </p>
          )}
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              padding: '8px 16px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-primary)',
              color: '#fff',
              border: 'none',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            <RefreshCcw size={16} strokeWidth={2} />
            {t('error.retry')}
          </button>

          <Link
            href="/"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              padding: '8px 16px',
              borderRadius: 'var(--radius-md)',
              background: 'transparent',
              color: 'var(--color-foreground)',
              border: '1px solid var(--color-border)',
              textDecoration: 'none',
              fontWeight: 500,
            }}
          >
            <Home size={16} strokeWidth={2} />
            {t('error.backHome')}
          </Link>
        </div>
      </div>
    </div>
  );
}
