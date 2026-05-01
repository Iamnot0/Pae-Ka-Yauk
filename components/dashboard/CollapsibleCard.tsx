'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * Card wrapper with a toggleable body. Built on `aria-expanded` + a state-
 * driven max-height so screen readers can announce the collapse, and
 * keyboard users get focusable controls. Body is unmounted on close so
 * heavy charts don't stay in memory.
 */
export function CollapsibleCard({
  title,
  defaultOpen = true,
  children,
}: {
  title: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="card-xl" style={{ padding: 0, overflow: 'hidden' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          width: '100%',
          minHeight: 'auto',
          padding: 'var(--space-4) var(--space-5)',
          background: 'transparent',
          border: 'none',
          borderRadius: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--space-3)',
          cursor: 'pointer',
          color: 'var(--color-foreground)',
        }}
      >
        <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.0625rem', fontWeight: 600 }}>
          {title}
        </span>
        <ChevronDown
          size={18}
          aria-hidden="true"
          style={{
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform var(--transition-fast)',
            color: 'var(--color-muted-fg)',
            flexShrink: 0,
          }}
        />
      </button>
      {open && (
        <div style={{ padding: '0 var(--space-5) var(--space-5)' }}>
          {children}
        </div>
      )}
    </div>
  );
}
