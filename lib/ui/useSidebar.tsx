'use client';

/**
 * Sidebar state — collapsed (desktop) vs open (mobile drawer).
 *
 * Desktop (>=900px): sidebar is always in the grid. `collapsed` switches
 * between full (240px, labels+icons) and rail (64px, icons only).
 *
 * Mobile (<900px): sidebar hides by default. `open` toggles a drawer overlay.
 *
 * `toggle()` is context-aware: on mobile it toggles `open`, on desktop `collapsed`.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

interface SidebarContextShape {
  collapsed: boolean;
  open: boolean; // mobile drawer
  toggle: () => void;
  close: () => void; // mobile: close drawer (e.g. after nav click)
  setCollapsed: (v: boolean) => void;
}

const SidebarContext = createContext<SidebarContextShape | null>(null);

const STORAGE_KEY = 'paeKaYauk.sidebar.collapsed';
const MOBILE_BREAKPOINT = 900;

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsedState] = useState(false);
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Initial load + breakpoint watcher
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener('change', sync);

    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === '1') setCollapsedState(true);

    return () => mq.removeEventListener('change', sync);
  }, []);

  // Apply data attribute so CSS can react (grid-template-columns, overlay visibility)
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    // On mobile, `collapsed` is irrelevant — drawer is binary open/closed
    if (isMobile) {
      root.setAttribute('data-sidebar', open ? 'drawer-open' : 'drawer-closed');
    } else {
      root.setAttribute('data-sidebar', collapsed ? 'collapsed' : 'expanded');
    }
  }, [collapsed, open, isMobile]);

  const setCollapsed = useCallback((v: boolean) => {
    setCollapsedState(v);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, v ? '1' : '0');
    }
  }, []);

  const toggle = useCallback(() => {
    if (isMobile) {
      setOpen(v => !v);
    } else {
      setCollapsed(!collapsed);
    }
  }, [isMobile, collapsed, setCollapsed]);

  const close = useCallback(() => setOpen(false), []);

  return (
    <SidebarContext.Provider value={{ collapsed, open, toggle, close, setCollapsed }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error('useSidebar must be used within <SidebarProvider>');
  return ctx;
}
