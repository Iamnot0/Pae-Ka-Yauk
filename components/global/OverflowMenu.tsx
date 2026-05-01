'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { MoreVertical, Moon, Sun, Languages, LogOut } from 'lucide-react';
import { useT, useLocale } from '@/lib/i18n/useT';
import { useTheme } from '@/lib/theme/useTheme';
import { ConnectionPill } from './ConnectionPill';

/**
 * Mobile-only overflow menu. Collects the 4 header utilities that don't fit on
 * a phone — theme toggle, language toggle, connection status, logout — behind
 * a single ⋮ trigger. Hidden on desktop via the `.overflow-menu` CSS class.
 */
export function OverflowMenu() {
  const t = useT();
  const router = useRouter();
  const { resolvedTheme, toggle: toggleTheme } = useTheme();
  const { locale, setLocale } = useLocale();

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  const isDark = resolvedTheme === 'dark';

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const onLogout = async () => {
    setBusy(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      router.push('/login');
      router.refresh();
      setOpen(false);
    }
  };

  return (
    <div ref={anchorRef} className="overflow-menu" style={{ position: 'relative' }}>
      <button
        type="button"
        className="icon-btn"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('menu.more')}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <MoreVertical size={20} strokeWidth={2} />
      </button>

      {open && (
        <div
          className="dropdown-panel"
          role="menu"
          style={{ minWidth: 240, padding: 'var(--space-2)' }}
        >
          <div
            className="dropdown-item"
            style={{ cursor: 'default', justifyContent: 'space-between' }}
          >
            <span style={{ color: 'var(--color-muted-fg)', fontSize: '0.75rem' }}>
              {t('sync.status')}
            </span>
            <ConnectionPill />
          </div>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              toggleTheme();
              setOpen(false);
            }}
            className="dropdown-item"
            style={{
              width: '100%',
              background: 'transparent',
              border: 'none',
              justifyContent: 'space-between',
              cursor: 'pointer',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              {isDark ? <Sun size={16} strokeWidth={2} /> : <Moon size={16} strokeWidth={2} />}
              {t('menu.theme')}
            </span>
            <span style={{ color: 'var(--color-muted-fg)', fontSize: '0.8125rem' }}>
              {isDark ? t('menu.themeDark') : t('menu.themeLight')}
            </span>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setLocale(locale === 'my' ? 'en' : 'my');
              setOpen(false);
            }}
            className="dropdown-item"
            style={{
              width: '100%',
              background: 'transparent',
              border: 'none',
              justifyContent: 'space-between',
              cursor: 'pointer',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <Languages size={16} strokeWidth={2} />
              {t('menu.language')}
            </span>
            <span style={{ color: 'var(--color-muted-fg)', fontSize: '0.8125rem' }}>
              {locale === 'my' ? 'မြန်မာ' : 'English'}
            </span>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={onLogout}
            disabled={busy}
            className="dropdown-item"
            style={{
              width: '100%',
              background: 'transparent',
              border: 'none',
              color: 'var(--color-destructive)',
              cursor: 'pointer',
            }}
          >
            <LogOut size={16} strokeWidth={2} />
            {t('nav.logout')}
          </button>
        </div>
      )}
    </div>
  );
}
