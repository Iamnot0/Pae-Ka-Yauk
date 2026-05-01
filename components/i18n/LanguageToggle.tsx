'use client';

import { useLocale } from '@/lib/i18n/useT';

export function LanguageToggle() {
  const { locale, setLocale } = useLocale();
  return (
    <button
      type="button"
      onClick={() => setLocale(locale === 'my' ? 'en' : 'my')}
      className="pill"
      style={{ background: 'var(--color-surface-alt)', color: 'var(--color-foreground)', cursor: 'pointer' }}
      aria-label="Toggle language"
    >
      {locale === 'my' ? 'MY' : 'EN'}
    </button>
  );
}
