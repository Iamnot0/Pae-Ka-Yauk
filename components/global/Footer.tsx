'use client';

/**
 * Global Footer — mounted once in app/layout.tsx.
 * Version + subtle branding. Connection pill lives in Header to be always-visible.
 */
export function Footer() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION ?? 'v0.1.0';

  return (
    <footer className="app-footer" role="contentinfo">
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-4)',
        maxWidth: '1400px',
        margin: '0 auto',
        width: '100%',
      }}>
        <span>
          © {new Date().getFullYear()} Pae Ka Yauk · ပဲကရောက်
        </span>
        <span className="tabular-nums" style={{ color: 'var(--color-subtle-fg)' }}>
          {version}
        </span>
      </div>
    </footer>
  );
}
