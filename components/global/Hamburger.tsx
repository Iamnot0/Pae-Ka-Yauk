'use client';

import { Menu } from 'lucide-react';
import { useSidebar } from '@/lib/ui/useSidebar';

/**
 * Mobile-only hamburger. Opens the drawer sidebar.
 * Hidden on desktop (use <SidebarToggle /> inside the sidebar instead).
 */
export function Hamburger() {
  const { toggle, open } = useSidebar();

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Open menu"
      aria-expanded={open ? 'true' : 'false'}
      className="mobile-hamburger"
      style={{
        display: 'none', // overridden at <900px below
        alignItems: 'center',
        justifyContent: 'center',
        width: 40,
        height: 40,
        borderRadius: 'var(--radius-sm)',
        background: 'transparent',
        border: 'none',
        color: 'var(--color-muted-fg)',
        cursor: 'pointer',
        padding: 0,
        minHeight: 'auto',
      }}
    >
      <Menu size={22} strokeWidth={2} />
      <style jsx>{`
        @media (max-width: 899px) {
          .mobile-hamburger {
            display: inline-flex !important;
          }
        }
      `}</style>
    </button>
  );
}
