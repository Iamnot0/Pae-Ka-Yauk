'use client';

/**
 * Inline card on the Edit Stock page — lets owner / baker print N
 * label stickers for this item to the NipponPOS sticker printer.
 *
 * The flow:
 *   1. User picks a quantity (default 1, capped at 100 per request).
 *   2. POST /api/print/sticker { itemId, qty }
 *   3. Server resolves SKU (auto-fills if blank), builds TSPL bytes,
 *      streams to /dev/usb/lp0.
 *   4. We surface the response: success → green tick + the assigned SKU
 *      (so owner can see what got printed); failure → friendly error +
 *      retry hint.
 *
 * Idempotency note: this isn't a money-write, so we don't mint a ULID.
 * Re-clicking simply prints again. If a stack of bad stickers comes out
 * (printer jam etc), the owner can press print again after fixing the
 * roll — no DB state to corrupt.
 */

import { useState, type FormEvent } from 'react';
import { Printer, CheckCircle2, AlertTriangle, Tag } from 'lucide-react';
import { useT } from '@/lib/i18n/useT';

interface Props {
  itemId: string;
  /** Current SKU on the item — null until first sticker print backfills one. */
  initialSku: string | null;
}

type State =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'ok'; sku: string; qty: number }
  | { kind: 'err'; message: string };

export function PrintStickersCard({ itemId, initialSku }: Props) {
  const t = useT();
  const [qty, setQty] = useState('1');
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [sku, setSku] = useState<string | null>(initialSku);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = Number(qty);
    if (!Number.isInteger(n) || n <= 0 || n > 100) {
      setState({ kind: 'err', message: t('sticker.err.qty') });
      return;
    }
    setState({ kind: 'busy' });
    try {
      const res = await fetch('/api/print/sticker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, qty: n }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setState({ kind: 'err', message: data.error || `HTTP ${res.status}` });
        return;
      }
      setSku(data.item.sku);
      setState({ kind: 'ok', sku: data.item.sku, qty: n });
    } catch (e) {
      setState({ kind: 'err', message: (e as Error).message });
    }
  };

  return (
    <form onSubmit={submit} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <Tag size={18} style={{ color: 'var(--color-primary)' }} />
        <h3 style={{ margin: 0 }}>{t('sticker.card.title')}</h3>
      </div>
      <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-muted-fg)' }}>
        {t('sticker.card.subtitle')}
      </p>

      {sku && (
        <div style={{
          padding: 'var(--space-2) var(--space-3)',
          background: 'var(--color-surface-alt)',
          borderRadius: 'var(--radius-sm)',
          fontSize: '0.875rem',
          fontFamily: 'var(--font-mono)',
        }}>
          <strong>{t('sticker.card.sku')}:</strong> {sku}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-2)' }}>
        <div style={{ flex: 1 }}>
          <label>{t('sticker.card.qty')}</label>
          <input
            type="number"
            inputMode="numeric"
            min="1"
            max="100"
            step="1"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            disabled={state.kind === 'busy'}
          />
        </div>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={state.kind === 'busy'}
          style={{ minHeight: 44 }}
        >
          <Printer size={16} />
          {state.kind === 'busy' ? t('common.loading') : t('sticker.card.print')}
        </button>
      </div>

      {state.kind === 'ok' && (
        <div role="status" style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 12px',
          background: 'var(--color-success-bg)',
          color: 'var(--color-success)',
          borderRadius: 'var(--radius-sm)',
          fontSize: '0.875rem',
        }}>
          <CheckCircle2 size={16} />
          {t('sticker.card.printed').replace('{n}', String(state.qty)).replace('{sku}', state.sku)}
        </div>
      )}

      {state.kind === 'err' && (
        <div role="alert" style={{
          display: 'flex', alignItems: 'flex-start', gap: 8,
          padding: '8px 12px',
          background: 'var(--color-destructive-bg)',
          color: 'var(--color-destructive)',
          borderRadius: 'var(--radius-sm)',
          fontSize: '0.875rem',
        }}>
          <AlertTriangle size={16} style={{ marginTop: 2, flexShrink: 0 }} />
          <span>{state.message}</span>
        </div>
      )}
    </form>
  );
}
