'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Save, Trash2, Coffee, Croissant } from 'lucide-react';
import { useT } from '@/lib/i18n/useT';
import type { DictKey } from '@/lib/i18n/dict';
import { ImageDropzone } from './ImageDropzone';
import type { SellableItem, ItemCategory, ProductionMode } from '@/lib/repos/items';

const CATEGORIES: ItemCategory[] = [
  'BAKERY_BREAD', 'BAKERY_CAKE', 'BAKERY_COOKIES', 'BAKERY_PASTRY', 'BAKERY_SAVORY',
  'COFFEE_HOT', 'COFFEE_COLD', 'TEA', 'COLD_DRINK', 'DESSERT', 'OTHER',
];

interface Props {
  initial?: SellableItem | null;
  mode: 'create' | 'edit';
}

export function ItemForm({ initial, mode }: Props) {
  const router = useRouter();
  const t = useT();

  const [name, setName]               = useState(initial?.name ?? '');
  const [nameLocal, setNameLocal]     = useState(initial?.nameLocal ?? '');
  // SKU is system-managed; no input field on this form. Existing items
  // keep whatever SKU they have, which we preserve on PATCH by simply
  // not sending the field.
  const [category, setCategory]       = useState<ItemCategory>(initial?.category ?? 'BAKERY_BREAD');
  const [price, setPrice]             = useState<string>(initial?.price != null ? String(initial.price) : '');
  const [manualCost, setManualCost]   = useState<string>(initial?.manualCost != null ? String(initial.manualCost) : '');
  const [taxRatePct, setTaxRatePct]   = useState<string>(initial?.taxRate != null ? String((initial.taxRate) * 100) : '0');
  const [imageUrl, setImageUrl]       = useState<string | null>(initial?.imageUrl ?? null);
  const [description, setDescription] = useState(initial?.description ?? '');
  const [productionMode, setProductionMode] = useState<ProductionMode>(initial?.productionMode ?? 'DIRECT');
  // Per-item expiry date (calendar). <input type="date"> uses ISO yyyy-mm-dd
  // internally; the browser renders the locale-appropriate display + calendar
  // picker (Boss is on Linux so Chrome/FF show the picker natively). The
  // shelfLifeDays integer field is now legacy — kept on the schema for
  // future "auto-set expiry on bake" work, but no longer captured here.
  const [expiryDate, setExpiryDate]   = useState<string>(initial?.expiryDate ?? '');
  const [unit, setUnit]               = useState<string>(initial?.unit ?? '');

  const [loading, setLoading]   = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError]       = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    setLoading(true);

    // manualCost: empty input → null (clears the value); non-empty must be a
    // non-negative finite number (or null). Server schema enforces too.
    const parsedCost = manualCost.trim() === '' ? null : Number(manualCost);
    const isoDate = /^\d{4}-\d{2}-\d{2}$/;
    const payload = {
      name: name.trim(),
      nameLocal: nameLocal.trim() || null,
      // sku omitted — preserved by the API (PATCH only updates fields sent).
      // For new items, server auto-generates an 8-digit code if absent.
      category,
      price: Number(price) || 0,
      manualCost: parsedCost != null && Number.isFinite(parsedCost) && parsedCost >= 0 ? parsedCost : null,
      taxRate: Math.max(0, Math.min(1, Number(taxRatePct) / 100 || 0)),
      imageUrl,
      description: description.trim() || null,
      productionMode,
      unit: unit.trim() || null,
      // Expiry only applies to BATCH (MIA) — drinks are made-to-order so no
      // shelf clock. Send null on DIRECT to clear any stale value.
      expiryDate: productionMode === 'BATCH' && isoDate.test(expiryDate) ? expiryDate : null,
    };

    try {
      const url = mode === 'create' ? '/api/items' : `/api/items/${initial!.id}`;
      const method = mode === 'create' ? 'POST' : 'PATCH';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || 'Save failed');
        return;
      }
      router.push('/stocks');
      router.refresh();
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!initial) return;
    if (!confirm(t('item.deleteConfirm'))) return;
    setDeleting(true);
    setError('');
    try {
      const res = await fetch(`/api/items/${initial.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || 'Delete failed');
        return;
      }
      router.push('/stocks');
      router.refresh();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', maxWidth: 920 }}>
      <div className="card item-form-grid">
        {/* Photo */}
        <div>
          <label style={{ marginBottom: 'var(--space-2)', fontWeight: 500 }}>{t('item.image')}</label>
          <ImageDropzone value={imageUrl} onChange={setImageUrl} fallbackLetter={name || 'P'} />
        </div>

        {/* Basic fields */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', minWidth: 0 }}>
          <div className="form-grid-2">
            <div>
              <label>{t('item.name')} *</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} placeholder="e.g. Latte" />
            </div>
            <div>
              <label>{t('item.nameLocal')}</label>
              <input lang="my" value={nameLocal} onChange={(e) => setNameLocal(e.target.value)} maxLength={200} placeholder="e.g. လတ်တေး" />
            </div>
          </div>

          {/* SKU input removed 2026-04-28 — codes are auto-generated on
              item create and on first sticker print. The current code is
              shown read-only inside the Print Stickers card below. */}
          <div>
            <label>{t('item.category')} *</label>
            <select value={category} onChange={(e) => setCategory(e.target.value as ItemCategory)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{t(`item.cat.${c}` as DictKey)}</option>
              ))}
            </select>
          </div>

          <div className="form-grid-3">
            <div>
              <label>{t('item.price')} *</label>
              <input
                type="number" inputMode="numeric" step="1" min="0"
                value={price} onChange={(e) => setPrice(e.target.value)}
                required placeholder="e.g. 3500"
              />
            </div>
            <div>
              <label>{t('item.cost')}</label>
              <input
                type="number" inputMode="numeric" step="1" min="0"
                value={manualCost} onChange={(e) => setManualCost(e.target.value)}
                placeholder="optional"
              />
            </div>
            <div>
              <label>{t('item.taxRate')}</label>
              <input
                type="number" inputMode="decimal" step="0.1" min="0" max="100"
                value={taxRatePct} onChange={(e) => setTaxRatePct(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>

          <div className={productionMode === 'BATCH' ? 'form-grid-2' : ''} style={productionMode === 'BATCH' ? undefined : { display: 'grid', gridTemplateColumns: '1fr', gap: 'var(--space-4)' }}>
            <div>
              <label>{t('item.unit')}</label>
              <select value={unit} onChange={(e) => setUnit(e.target.value)}>
                <option value="">— {t('common.optional')} —</option>
                <option value="PCS">PCS</option>
                <option value="BOX">BOX</option>
                <option value="PACK">PACK</option>
                <option value="CUP">CUP</option>
                <option value="BOTTLE">BOTTLE</option>
              </select>
            </div>
            {/* Expiry only makes sense for MIA (BATCH) — drinks are made-to-
                order. Browser supplies the calendar picker; we store ISO
                yyyy-mm-dd and the Stocks table renders "N Day(s)" live. */}
            {productionMode === 'BATCH' && (
              <div>
                <label>{t('item.expiryDate')}</label>
                <input
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  placeholder="dd-mm-yyyy"
                />
              </div>
            )}
          </div>

          <div>
            <label>{t('item.description')}</label>
            <textarea
              value={description} onChange={(e) => setDescription(e.target.value)}
              rows={2} maxLength={2000} style={{ resize: 'vertical' }}
              placeholder="Optional — shows on receipt or description screens"
            />
          </div>

          {/* Production mode — card-style picker. Plain language, concrete examples. */}
          <fieldset style={{
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            padding: 'var(--space-3)',
          }}>
            <legend style={{ padding: '0 8px', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-muted-fg)' }}>
              {t('item.prodMode.legend')}
            </legend>
            <div role="radiogroup" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--space-3)' }}>
              <ProdModeCard
                selected={productionMode === 'DIRECT'}
                onSelect={() => setProductionMode('DIRECT')}
                icon={<Coffee size={22} strokeWidth={2} />}
                title={t('item.prodMode.direct')}
                desc={t('item.prodMode.directDesc')}
                example={t('item.prodMode.directEg')}
              />
              <ProdModeCard
                selected={productionMode === 'BATCH'}
                onSelect={() => setProductionMode('BATCH')}
                icon={<Croissant size={22} strokeWidth={2} />}
                title={t('item.prodMode.batch')}
                desc={t('item.prodMode.batchDesc')}
                example={t('item.prodMode.batchEg')}
              />
            </div>
          </fieldset>
        </div>
      </div>

      {error && (
        <div role="alert" style={{
          padding: 'var(--space-3) var(--space-4)',
          background: 'var(--color-destructive-bg)',
          border: '1px solid var(--color-destructive)',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--color-destructive)',
          fontSize: '0.9375rem',
        }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="submit" className="btn btn-primary" disabled={loading}>
          <Save size={16} /> {loading ? 'Saving…' : (mode === 'create' ? t('item.add') : t('common.save'))}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => router.push('/stocks')} disabled={loading}>
          {t('common.cancel')}
        </button>
        {mode === 'edit' && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={handleDelete}
            disabled={deleting}
            style={{ marginLeft: 'auto', color: 'var(--color-destructive)' }}
          >
            <Trash2 size={16} /> {deleting ? 'Deleting…' : t('common.delete')}
          </button>
        )}
      </div>
    </form>
  );
}

/**
 * Card-style radio for picking production mode. Clicking anywhere on the card
 * selects it — the native <input> is visually hidden but stays in the DOM for
 * accessibility (keyboard nav, screen readers) and form submission.
 */
function ProdModeCard({
  selected, onSelect, icon, title, desc, example,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  desc: string;
  example: string;
}) {
  return (
    <label
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 'var(--space-3)',
        borderRadius: 'var(--radius-md)',
        border: `1.5px solid ${selected ? 'var(--color-primary)' : 'var(--color-border)'}`,
        background: selected ? 'var(--color-surface-alt)' : 'var(--color-surface)',
        cursor: 'pointer',
        transition: 'border-color var(--transition-fast), background var(--transition-fast)',
        position: 'relative',
      }}
    >
      <input
        type="radio"
        name="prodMode"
        checked={selected}
        onChange={onSelect}
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 'var(--radius-sm)',
          background: selected ? 'var(--color-primary)' : 'var(--color-surface-alt)',
          color: selected ? '#fff' : 'var(--color-primary)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
          transition: 'background var(--transition-fast), color var(--transition-fast)',
        }}>
          {icon}
        </div>
        <strong style={{ fontSize: '0.9375rem' }}>{title}</strong>
      </div>
      <div style={{ color: 'var(--color-muted-fg)', fontSize: '0.8125rem', lineHeight: 1.4 }}>
        {desc}
      </div>
      <div style={{ color: 'var(--color-subtle-fg)', fontSize: '0.75rem', fontStyle: 'italic' }}>
        {example}
      </div>
    </label>
  );
}
