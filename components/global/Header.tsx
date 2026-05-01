'use client';

import Link from 'next/link';
import { useLocale } from '@/lib/i18n/useT';
import { LanguageToggle } from '@/components/i18n/LanguageToggle';
import { ConnectionPill } from './ConnectionPill';
import { SyncStatusPill } from './SyncStatusPill';
import { ThemeToggle } from './ThemeToggle';
import { Hamburger } from './Hamburger';
import { SearchMaterials } from './SearchMaterials';
import { AlertsBell } from './AlertsBell';
import { LogoutButton } from './LogoutButton';
import { OverflowMenu } from './OverflowMenu';

interface Brand {
  name: string;
  nameLocal: string | null;
  logoUrl: string | null;
}

export function Header({ brand, role }: { brand: Brand | null; role?: string }) {
  const { locale } = useLocale();
  // Fall back to the project's seed name when brand fetch returns null —
  // shouldn't happen in practice since requireUser() implies a tenant exists.
  const displayName = brand?.name ?? 'Pae Ka Yauk';
  const displayLocal = brand?.nameLocal ?? 'ပဲကရောက်';
  const logoUrl = brand?.logoUrl ?? null;
  // Show only the active locale's brand text (Boss preference 2026-04-26):
  // EN locale → English, MY locale → Burmese — never both stacked.
  const brandLabel = locale === 'my' ? displayLocal : displayName;

  return (
    <header className="app-header" role="banner">
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-4)',
        maxWidth: '1400px',
        margin: '0 auto',
        width: '100%',
      }}>
        {/* Brand + hamburger */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexShrink: 0, minWidth: 0 }}>
          <Hamburger />
          <Link
            href="/"
            className="header-brand"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
              textDecoration: 'none',
              color: 'inherit',
              lineHeight: 1.1,
              minWidth: 0,
            }}
            aria-label={brandLabel}
          >
            {logoUrl && (
              // Logo + bilingual text: owner wants both visible. The alt
              // attribute is empty on purpose ("just logo no need to include
              // logo alt text") — the screen-reader-friendly name lives on
              // the parent Link's aria-label.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt=""
                aria-hidden="true"
                style={{
                  height: 56,
                  width: 'auto',
                  maxWidth: 200,
                  objectFit: 'contain',
                  flexShrink: 0,
                  display: 'block',
                }}
              />
            )}
            <span
              lang={locale === 'my' ? 'my' : undefined}
              style={{
                fontFamily: locale === 'my' ? 'var(--font-myanmar)' : 'var(--font-display)',
                fontSize: '1.375rem',
                fontWeight: 700,
                color: 'var(--color-primary)',
                letterSpacing: locale === 'my' ? '0' : '-0.01em',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                minWidth: 0,
              }}
            >
              {brandLabel}
            </span>
          </Link>
        </div>

        {/* Search — desktop only, hidden on mobile */}
        <div className="header-search-wrap" style={{ flex: '1 1 auto', display: 'flex', justifyContent: 'center', minWidth: 0 }}>
          <div style={{ width: '100%', maxWidth: 480 }}>
            <SearchMaterials />
          </div>
        </div>

        {/* Right cluster */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0, marginLeft: 'auto' }}>
          <AlertsBell />
          {/* Desktop-only cluster — collapsed into OverflowMenu on mobile */}
          <div className="header-desktop-cluster" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <SyncStatusPill canDebug={role === 'OWNER' || role === 'MANAGER'} />
            <ConnectionPill />
            <ThemeToggle />
            <LanguageToggle />
            <LogoutButton />
          </div>
          {/* Mobile-only overflow */}
          <OverflowMenu />
        </div>
      </div>
    </header>
  );
}
