'use client';

/**
 * Locale context + `useT` hook for bilingual rendering.
 *
 * Usage:
 *   const t = useT();
 *   return <button>{t('pos.payNow')}</button>;
 *
 * The provider lives in app/layout.tsx. Default locale 'my'.
 * Locale toggle persists to localStorage.
 */

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { tr, type DictKey, type Locale } from './dict';

interface LocaleContextShape {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: DictKey) => string;
}

const LocaleContext = createContext<LocaleContextShape | null>(null);

const STORAGE_KEY = 'paeKaYauk.locale';
const DEFAULT_LOCALE: Locale = 'my';

export function LocaleProvider({ children, initial }: { children: ReactNode; initial?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(initial ?? DEFAULT_LOCALE);

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (stored === 'my' || stored === 'en') {
      setLocaleState(stored);
    }
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('lang', locale === 'my' ? 'my-MM' : 'en');
    }
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const t = useCallback((key: DictKey) => tr(key, locale), [locale]);

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t }}>{children}</LocaleContext.Provider>
  );
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale must be used within <LocaleProvider>');
  return ctx;
}

export function useT() {
  return useLocale().t;
}
