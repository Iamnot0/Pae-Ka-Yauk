'use client';

import { useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChefHat, CheckCircle2, Save, PackagePlus, AlertCircle } from 'lucide-react';
import { useT } from '@/lib/i18n/useT';
import { MMK } from '@/components/i18n/MMK';
import type { Recipe } from '@/lib/repos/recipes';

interface BatchItem {
  id: string;
  name: string;
  nameLocal: string | null;
  category: string;
  finishedGoodsOnHand: number;
}

interface Props {
  items: BatchItem[];
  recipes: Record<string, Recipe>;
}

interface LogResult {
  productionBatchId: string;
  itemName: string;
  batchCount: number;
  expectedYield: number;
  actualYield: number;
  finishedGoodsOnHand: number;
  deductions: Array<{ materialId: string; qty: number; unit: string }>;
}

export function ProductionScreen({ items, recipes }: Props) {
  const t = useT();
  const router = useRouter();

  const [itemId, setItemId] = useState<string>(items[0]?.id ?? '');
  const [batchCount, setBatchCount] = useState('1');
  const [actualYield, setActualYield] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<LogResult | null>(null);

  const item = useMemo(() => items.find((i) => i.id === itemId) ?? null, [items, itemId]);
  const recipe = itemId ? recipes[itemId] : null;

  const batchNum = Math.max(0, Number(batchCount) || 0);
  const expectedYield = recipe ? recipe.yield * batchNum : 0;
  const yieldToUse = actualYield.trim() ? Math.max(0, Number(actualYield) || 0) : expectedYield;

  // Preview what ingredients will be deducted
  const preview = useMemo(() => {
    if (!recipe || batchNum <= 0) return [];
    return recipe.ingredients.map((i) => ({
      name: i.materialName ?? i.materialId.slice(0, 6),
      baseUnit: i.materialBaseUnit ?? i.unit,
      qty: i.quantity * batchNum,
      unit: i.unit,
    }));
  }, [recipe, batchNum]);

  // --------------------------------------------------------------
  // Empty state — no BATCH items configured
  // --------------------------------------------------------------
  if (items.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 'var(--space-6)' }}>
        <ChefHat size={48} style={{ color: 'var(--color-subtle-fg)', marginBottom: 'var(--space-3)' }} />
        <h1>{t('prod.title')}</h1>
        <p style={{ color: 'var(--color-muted-fg)', marginBottom: 'var(--space-4)' }}>
          {t('prod.noBatchItems')}
        </p>
        <Link href="/stocks" className="btn btn-primary">{t('nav.items')}</Link>
      </div>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!item || !recipe || batchNum <= 0) return;
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/production', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: item.id,
          batchCount: batchNum,
          actualYield: actualYield.trim() ? yieldToUse : undefined,
          notes: notes.trim() || null,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || 'Bake log failed');
        return;
      }
      setResult(await res.json() as LogResult);
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setResult(null); setBatchCount('1'); setActualYield(''); setNotes(''); setError('');
  };

  // --------------------------------------------------------------
  // Success view
  // --------------------------------------------------------------
  if (result) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 'var(--space-7) var(--space-5)', maxWidth: 560, margin: '0 auto' }}>
        <CheckCircle2 size={56} style={{ color: 'var(--color-success)', marginBottom: 'var(--space-3)' }} />
        <h2 style={{ margin: 0 }}>{t('prod.success')}</h2>
        <p style={{ color: 'var(--color-foreground)', fontSize: '1.125rem', marginTop: 'var(--space-3)' }}>
          <strong>{result.itemName}</strong> · +{result.actualYield} pcs
          {result.actualYield !== result.expectedYield && (
            <span style={{ color: 'var(--color-warning)', fontSize: '0.875rem', marginLeft: 8 }}>
              (expected {result.expectedYield})
            </span>
          )}
        </p>
        <p style={{ color: 'var(--color-muted-fg)' }}>
          Now in stock: <strong>{result.finishedGoodsOnHand} pcs</strong>
        </p>
        <details style={{ textAlign: 'left', margin: 'var(--space-3) auto', maxWidth: 400, fontSize: '0.875rem', color: 'var(--color-muted-fg)' }}>
          <summary style={{ cursor: 'pointer' }}>Ingredients deducted ({result.deductions.length})</summary>
          <ul style={{ marginTop: 'var(--space-2)' }}>
            {result.deductions.map((d, i) => (
              <li key={i}>
                {d.qty.toLocaleString(undefined, { maximumFractionDigits: 4 })} {d.unit}
              </li>
            ))}
          </ul>
        </details>
        <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'center', marginTop: 'var(--space-4)', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary" onClick={reset}>
            <PackagePlus size={16} /> {t('prod.another')}
          </button>
          <Link href="/inventory" className="btn btn-secondary">
            {t('stock.receive.backToList')}
          </Link>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------
  // Main bake form
  // --------------------------------------------------------------
  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', maxWidth: 720 }}>
      <header>
        <h1 style={{ marginBottom: 4 }}>{t('prod.title')}</h1>
        <p style={{ color: 'var(--color-muted-fg)', margin: 0, fontSize: '0.9375rem' }}>
          {t('prod.subtitle')}
        </p>
      </header>

      <div className="card" style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <div>
          <label>{t('prod.pickItem')} *</label>
          <select value={itemId} onChange={(e) => setItemId(e.target.value)} required>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}{i.nameLocal ? ` · ${i.nameLocal}` : ''} (in stock: {i.finishedGoodsOnHand})
              </option>
            ))}
          </select>
        </div>

        {!recipe && item && (
          <div role="alert" style={{
            padding: 'var(--space-2) var(--space-3)',
            background: 'var(--color-destructive-bg)',
            border: '1px solid var(--color-destructive)',
            color: 'var(--color-destructive)',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.875rem',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <AlertCircle size={14} /> {t('prod.recipeMissing')}
          </div>
        )}

        {recipe && (
          <>
            <div className="form-grid-2" style={{ gap: 'var(--space-3)' }}>
              <div>
                <label>{t('prod.batches')} *</label>
                <input
                  type="number" inputMode="decimal" step="0.25" min="0.25"
                  value={batchCount} onChange={(e) => setBatchCount(e.target.value)}
                  required
                />
                <small style={{ color: 'var(--color-muted-fg)' }}>
                  {t('prod.expectedYield')}: <strong>{expectedYield} pcs</strong> ({recipe.yield} × {batchCount})
                </small>
              </div>
              <div>
                <label>{t('prod.actualYield')}</label>
                <input
                  type="number" inputMode="decimal" step="1" min="0"
                  value={actualYield} onChange={(e) => setActualYield(e.target.value)}
                  placeholder={String(expectedYield)}
                />
                <small style={{ color: 'var(--color-muted-fg)' }}>{t('prod.yieldHint')}</small>
              </div>
            </div>

            {preview.length > 0 && (
              <div style={{
                background: 'var(--color-background)',
                border: '1px dashed var(--color-border-strong)',
                borderRadius: 'var(--radius-sm)',
                padding: 'var(--space-3)',
              }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>{t('prod.willDeduct')}</div>
                <ul style={{ margin: 0, paddingLeft: 20, fontSize: '0.9375rem' }}>
                  {preview.map((p, i) => (
                    <li key={i}>
                      <strong className="tabular-nums">{p.qty.toLocaleString(undefined, { maximumFractionDigits: 4 })} {p.unit}</strong> {p.name}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <label>{t('prod.notes')}</label>
              <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
            </div>
          </>
        )}
      </div>

      {error && (
        <div role="alert" className="card" style={{
          borderColor: 'var(--color-destructive)',
          color: 'var(--color-destructive)',
          background: 'var(--color-destructive-bg)',
        }}>{error}</div>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={saving || !recipe || batchNum <= 0}
        >
          <Save size={16} /> {saving ? t('prod.submitting') : t('prod.submit')}
        </button>
        <Link href="/inventory" className="btn btn-secondary">{t('common.cancel')}</Link>
      </div>
    </form>
  );
}
