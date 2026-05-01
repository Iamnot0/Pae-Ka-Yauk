'use client';

/**
 * Theme context + hook.
 *
 * Modes:
 *   - 'light' — force light
 *   - 'dark'  — force dark
 *   - 'system' — follow OS preference (default)
 *
 * Persistence (changed 2026-04-28 — was localStorage-only with a pre-
 * hydration `<script>`):
 *   - The PREFERENCE ('light' | 'dark' | 'system') is stored in
 *     localStorage so the user's chosen mode survives sessions on the
 *     same browser.
 *   - The RESOLVED theme ('light' | 'dark') is mirrored to a cookie
 *     so `app/layout.tsx` (server component) can stamp data-theme on
 *     <html> *before* hydrating React. Solves the FOUC without a
 *     client-side script (which React 19 warns about).
 *
 * Server reads cookie → stamps. Client maintains both. When system
 * preference changes (media-query event), we update the cookie too so
 * the next SSR pass picks it up.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

interface ThemeContextShape {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextShape | null>(null);

const STORAGE_KEY = 'paeKaYauk.theme';
/** Read by `app/layout.tsx` via next/headers `cookies()` to stamp html[data-theme]. */
export const RESOLVED_COOKIE = 'pky.themeResolved';

function writeResolvedCookie(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  // 1-year cookie. SameSite=Lax is fine — theme is non-sensitive.
  // path=/ so every route picks it up server-side.
  document.cookie = `${RESOLVED_COOKIE}=${resolved}; path=/; max-age=31536000; samesite=lax`;
}

function resolve(theme: Theme): ResolvedTheme {
  if (theme === 'system') {
    if (typeof window === 'undefined') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}

function applyTheme(resolved: ResolvedTheme, withTransition = true) {
  const root = document.documentElement;
  if (withTransition) {
    root.classList.add('theme-transitioning');
    window.setTimeout(() => root.classList.remove('theme-transitioning'), 220);
  }
  root.setAttribute('data-theme', resolved);
  // Update browser chrome color so iOS/Android status bar matches
  const themeColorMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (themeColorMeta) {
    themeColorMeta.content = resolved === 'dark' ? '#242939' : '#6B4423';
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('system');
  const [resolvedTheme, setResolved] = useState<ResolvedTheme>('light');

  // Initial load — read localStorage + resolve. Mirror to cookie so the
  // NEXT server render gets it right (this hydration cycle's HTML was
  // already emitted with whatever value layout.tsx had).
  useEffect(() => {
    const stored = (typeof window !== 'undefined'
      ? (window.localStorage.getItem(STORAGE_KEY) as Theme | null)
      : null);
    const initial: Theme = stored === 'light' || stored === 'dark' || stored === 'system'
      ? stored
      : 'system';
    setThemeState(initial);
    const r = resolve(initial);
    setResolved(r);
    applyTheme(r, false);
    writeResolvedCookie(r);
  }, []);

  // Listen to system preference changes when in 'system' mode. Update
  // both the in-memory state AND the cookie so an SSR refresh after the
  // user toggles their OS theme stays in sync.
  useEffect(() => {
    if (theme !== 'system' || typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      const r: ResolvedTheme = mq.matches ? 'dark' : 'light';
      setResolved(r);
      applyTheme(r);
      writeResolvedCookie(r);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    const r = resolve(next);
    setResolved(r);
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, next);
    applyTheme(r);
    writeResolvedCookie(r);
  }, []);

  const toggle = useCallback(() => {
    // Simple 2-way toggle cycles light ↔ dark (leaves 'system' explicitly opt-in via menu later)
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  }, [resolvedTheme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within <ThemeProvider>');
  return ctx;
}
