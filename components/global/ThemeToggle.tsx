'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/lib/theme/useTheme';

export function ThemeToggle() {
  const { resolvedTheme, toggle } = useTheme();
  const isDark = resolvedTheme === 'dark';
  return (
    <button
      type="button"
      onClick={toggle}
      className="pill"
      style={{
        background: 'var(--color-surface-alt)',
        color: 'var(--color-foreground)',
        cursor: 'pointer',
        padding: '6px 10px',
      }}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Light mode' : 'Dark mode'}
    >
      {isDark ? <Sun size={14} strokeWidth={2} /> : <Moon size={14} strokeWidth={2} />}
    </button>
  );
}
