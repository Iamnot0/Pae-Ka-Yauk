import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

type Tint = 'success' | 'info' | 'warning' | 'destructive' | 'primary';

interface Props {
  icon: LucideIcon;
  label: string;
  labelLocal?: string;
  value: ReactNode;
  tint: Tint;
}

const TINT_BG: Record<Tint, string> = {
  success:     'var(--color-success-bg)',
  info:        'var(--color-info-bg)',
  warning:     'var(--color-warning-bg)',
  destructive: 'var(--color-destructive-bg)',
  primary:     'var(--color-surface-alt)',
};

const TINT_FG: Record<Tint, string> = {
  success:     'var(--color-success)',
  info:        'var(--color-info)',
  warning:     'var(--color-warning)',
  destructive: 'var(--color-destructive)',
  primary:     'var(--color-primary)',
};

/**
 * Vertical-stack KPI card. Tight padding (space-3) instead of inheriting
 * card-xl's space-5 so the cell can render `11,550 MMK` cleanly even on a
 * 1366px laptop with the sidebar expanded — that's where the cashier
 * spends their day. Override the .card-xl class with inline padding so
 * other dashboard panels keep the larger pad.
 */
export function KpiCard({ icon: Icon, label, labelLocal, value, tint }: Props) {
  return (
    <div
      className="card-xl"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minWidth: 0,
        padding: 'var(--space-3) var(--space-4)',
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 32,
          height: 32,
          borderRadius: 'var(--radius-sm)',
          background: TINT_BG[tint],
          color: TINT_FG[tint],
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Icon size={18} strokeWidth={2} />
      </div>
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: '1.125rem',
          fontWeight: 700,
          lineHeight: 1.2,
          color: 'var(--color-foreground)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          minWidth: 0,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: '0.75rem',
          color: 'var(--color-muted-fg)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {label}
        {labelLocal && (
          <>
            <span style={{ margin: '0 var(--space-2)', color: 'var(--color-subtle-fg)' }}>·</span>
            <span lang="my" className="text-myanmar">{labelLocal}</span>
          </>
        )}
      </div>
    </div>
  );
}
