'use client';

/**
 * Collapse/expand toggle that lives INSIDE the sidebar (desktop only).
 * Hidden on mobile — the drawer is opened via the Hamburger in Header.
 */
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useSidebar } from '@/lib/ui/useSidebar';

export function SidebarToggle() {
  const { toggle, collapsed } = useSidebar();
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      title={collapsed ? 'Expand' : 'Collapse'}
      className="sidebar-toggle"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 32,
        height: 32,
        borderRadius: 'var(--radius-sm)',
        background: 'transparent',
        border: 'none',
        color: 'var(--color-muted-fg)',
        cursor: 'pointer',
        padding: 0,
        minHeight: 'auto',
        transition: 'background var(--transition-fast), color var(--transition-fast)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--color-surface-alt)';
        e.currentTarget.style.color = 'var(--color-foreground)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'var(--color-muted-fg)';
      }}
    >
      <Icon size={18} strokeWidth={1.75} />
    </button>
  );
}
