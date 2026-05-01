'use client';

/**
 * ReceiveStockModal — owner/manager logs a finished-goods receipt for a
 * BATCH item. Posts to /api/stocks/receive with a client-minted ULID so the
 * call is idempotent on retry.
 *
 * Notes (Boss's intent, plan-1 task 13):
 *   - Picker filters to BATCH items only — DIRECT items deduct ingredients
 *     at sale time and have no shelf count to credit.
 *   - costPerUnit is left blank by default; the operator enters fresh cost
 *     per receive event (a shipment may be priced differently from the
 *     item's stored manualCost).
 *   - Modal does NOT close on backdrop click in this version. Submit or
 *     explicit Cancel only — protects against losing a half-typed entry.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { useT } from '@/lib/i18n/useT';
import { newId } from '@/lib/client/ulid';

export interface ReceiveStockItem {
  id: string;
  name: string;
  productionMode: 'DIRECT' | 'BATCH';
  manualCost: number | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  preselectedItemId?: string;
  items: ReceiveStockItem[];
}

export function ReceiveStockModal({
  open, onClose, onSuccess, preselectedItemId, items,
}: Props) {
  const t = useT();
  const [itemId, setItemId] = useState(preselectedItemId ?? '');
  const [qty, setQty] = useState<string>('');
  const [costPerUnit, setCostPerUnit] = useState<string>('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-sync the picker when the parent supplies a different preselected id
  // (e.g. owner clicks "Receive" from a specific row in StocksTable).
  useEffect(() => {
    if (open && preselectedItemId) setItemId(preselectedItemId);
  }, [open, preselectedItemId]);

  const batchItems = items.filter((i) => i.productionMode === 'BATCH');

  function reset() {
    setItemId('');
    setQty('');
    setCostPerUnit('');
    setNote('');
    setError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/stocks/receive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: newId(),
          itemId,
          qty: Number(qty),
          costPerUnit: costPerUnit ? Number(costPerUnit) : undefined,
          note: note || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      onSuccess();
      onClose();
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  const submitDisabled = submitting || !itemId || !qty;

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="receive-stock-title" className="modal-overlay">
      <form
        onSubmit={handleSubmit}
        className="modal-card"
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
      >
        <h3 id="receive-stock-title" style={{ margin: 0 }}>
          {t('stocks.modal.receive.title')}
        </h3>

        <div>
          <label>{t('stocks.modal.receive.item')} *</label>
          <select
            value={itemId}
            onChange={(e) => setItemId(e.target.value)}
            required
            disabled={submitting}
            autoFocus={!preselectedItemId}
          >
            <option value="">—</option>
            {batchItems.map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label>{t('stocks.modal.receive.qty')} *</label>
          <input
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            required
            disabled={submitting}
          />
        </div>

        <div>
          <label>{t('stocks.modal.receive.cost')}</label>
          <input
            type="number"
            min={0}
            step={0.01}
            inputMode="decimal"
            value={costPerUnit}
            onChange={(e) => setCostPerUnit(e.target.value)}
            disabled={submitting}
          />
        </div>

        <div>
          <label>{t('stocks.modal.receive.note')}</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={500}
            disabled={submitting}
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
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={submitting}
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitDisabled}
          >
            {submitting ? '…' : t('stocks.modal.receive.submit')}
          </button>
        </div>
      </form>
    </div>
  );
}
