'use client';

/**
 * Void Sale modal — confirms intent, captures the reason, and POSTs to
 * /api/sales/[id]/void. The endpoint is idempotent on the sale id, so a
 * slow network or accidental double-click never produces two reversals.
 */

import { useState, type FormEvent } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { useT } from '@/lib/i18n/useT';
import { MMK } from '@/components/i18n/MMK';

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  sale: {
    id: string;
    receiptNumber: string;
    total: number;
  } | null;
}

export function VoidSaleModal({ open, onClose, onSuccess, sale }: Props) {
  const t = useT();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!open && (reason || error)) {
    setReason('');
    setError('');
  }
  if (!open || !sale) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!reason.trim()) {
      setError(t('void.err.reasonRequired'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/sales/${sale.id}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 207) {
        setError(data.error || t('void.err.failed'));
        return;
      }
      onSuccess();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form onSubmit={submit} className="modal-card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <h2 style={{ margin: 0, flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={18} style={{ color: 'var(--color-destructive)' }} />
            {t('void.title')}
          </h2>
          <button type="button" onClick={onClose} className="icon-btn" aria-label="Close">
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-muted-fg)', lineHeight: 1.5 }}>
          {t('void.subtitle')}
        </p>

        <div style={{
          padding: 'var(--space-2) var(--space-3)',
          background: 'var(--color-surface-alt)',
          borderRadius: 'var(--radius-sm)',
          fontSize: '0.875rem',
        }}>
          <div><strong>{t('void.field.receipt')}</strong>: {sale.receiptNumber}</div>
          <div><strong>{t('void.field.total')}</strong>: <MMK amount={sale.total} /></div>
        </div>

        <div>
          <label>{t('void.field.reason')} *</label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            placeholder={t('void.field.reason.hint')}
            required
            autoFocus
          />
        </div>

        {error && (
          <div role="alert" style={{
            padding: '8px 12px',
            background: 'var(--color-destructive-bg)',
            color: 'var(--color-destructive)',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.875rem',
          }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            className="btn"
            disabled={submitting}
            style={{
              background: 'var(--color-destructive)',
              color: '#fff',
              borderColor: 'var(--color-destructive)',
            }}
          >
            {submitting ? t('common.loading') : t('void.confirm')}
          </button>
        </div>
      </form>
    </div>
  );
}
