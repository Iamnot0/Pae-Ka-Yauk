'use client';

/**
 * Log Waste modal — used on /inventory to record raw-material write-offs
 * (spilled, mouldy, broken, staff meal, etc).
 *
 * Mints a client ULID and POSTs to /api/inventory/waste; the endpoint is
 * idempotent so a slow network or accidental double-click never produces
 * two deductions. On success, the parent re-renders so on-hand counts
 * reflect the write-off.
 */

import { useState, type FormEvent } from 'react';
import { X, Trash2 } from 'lucide-react';
import { useT } from '@/lib/i18n/useT';
import type { DictKey } from '@/lib/i18n/dict';
import type { RawMaterial } from '@/lib/repos/materials';
import { newId } from '@/lib/client/ulid';

type Reason =
  | 'SPOILED' | 'OVERPRODUCTION' | 'STAFF_MEAL' | 'TESTING'
  | 'CUSTOMER_RETURN' | 'BREAKAGE' | 'THEFT' | 'OTHER';

const REASON_DICT: Record<Reason, DictKey> = {
  SPOILED:         'waste.spoiled',
  OVERPRODUCTION:  'waste.overproduction',
  STAFF_MEAL:      'waste.staffMeal',
  TESTING:         'waste.testing',
  CUSTOMER_RETURN: 'waste.customerReturn',
  BREAKAGE:        'waste.breakage',
  THEFT:           'waste.theft',
  OTHER:           'waste.other',
};

const REASON_ORDER: Reason[] = [
  'SPOILED', 'OVERPRODUCTION', 'BREAKAGE', 'STAFF_MEAL',
  'CUSTOMER_RETURN', 'TESTING', 'THEFT', 'OTHER',
];

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  /** Optional preselect — when a row's "Log waste" button is clicked. */
  preselectedMaterialId?: string;
  materials: RawMaterial[];
}

export function WasteModal({ open, onClose, onSuccess, preselectedMaterialId, materials }: Props) {
  const t = useT();
  const [materialId, setMaterialId] = useState(preselectedMaterialId ?? '');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState<Reason>('SPOILED');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Reset state when the modal closes so the next open is fresh.
  if (!open && (materialId !== (preselectedMaterialId ?? '') || qty || note || error)) {
    setMaterialId(preselectedMaterialId ?? '');
    setQty('');
    setReason('SPOILED');
    setNote('');
    setError('');
  }

  if (!open) return null;

  const selected = materials.find((m) => m.id === materialId) ?? null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const qtyNum = Number(qty);
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      setError(t('waste.err.qtyInvalid'));
      return;
    }
    if (!selected) {
      setError(t('waste.err.pickMaterial'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/inventory/waste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: newId(),
          materialId: selected.id,
          qty: qtyNum,
          unit: selected.baseUnit,
          reason,
          note: note.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || t('waste.err.saveFailed'));
        return;
      }
      onSuccess();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="waste-title" className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form onSubmit={handleSubmit} className="modal-card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <h2 id="waste-title" style={{ margin: 0, flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Trash2 size={18} style={{ color: 'var(--color-destructive)' }} />
            {t('waste.modal.title')}
          </h2>
          <button type="button" onClick={onClose} className="icon-btn" aria-label="Close">
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--color-muted-fg)' }}>
          {t('waste.modal.subtitle')}
        </p>

        <div>
          <label>{t('waste.field.material')} *</label>
          <select
            value={materialId}
            onChange={(e) => setMaterialId(e.target.value)}
            required
            disabled={!!preselectedMaterialId}
          >
            <option value="">— {t('waste.pick')} —</option>
            {materials.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}{m.nameLocal ? ` · ${m.nameLocal}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="form-grid-2">
          <div>
            <label>{t('waste.field.qty')} {selected ? `(${selected.baseUnit})` : ''} *</label>
            <input
              type="number" inputMode="decimal" step="any" min="0"
              value={qty} onChange={(e) => setQty(e.target.value)}
              required autoFocus
            />
          </div>
          <div>
            <label>{t('waste.field.reason')} *</label>
            <select value={reason} onChange={(e) => setReason(e.target.value as Reason)}>
              {REASON_ORDER.map((r) => (
                <option key={r} value={r}>{t(REASON_DICT[r])}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label>{t('waste.field.note')}</label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder={t('waste.field.note.hint')}
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
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? t('common.loading') : t('waste.modal.save')}
          </button>
        </div>
      </form>
    </div>
  );
}
