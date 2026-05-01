'use client';

import { useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Save, Check, Search, Package, CheckCircle2, PackagePlus } from 'lucide-react';
import { useT } from '@/lib/i18n/useT';
import { MMK } from '@/components/i18n/MMK';
import type { RawMaterial } from '@/lib/repos/materials';

interface Props {
  materials: RawMaterial[];
}

/**
 * Receive Stock — one shipment = one material = one batch + one movement.
 *
 * Keeps the flow linear: pick material → enter qty + cost → (expiry if needed)
 * → confirm. Shows the running total live so the operator catches typos
 * ("500000" instead of "5,000") before hitting submit.
 */
export function ReceiveStockForm({ materials }: Props) {
  const t = useT();
  const router = useRouter();

  // Empty state — no materials = can't receive anything
  if (materials.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 'var(--space-6)' }}>
        <Package size={40} style={{ color: 'var(--color-subtle-fg)', marginBottom: 'var(--space-3)' }} />
        <h2>{t('stock.receive.title')}</h2>
        <p style={{ color: 'var(--color-muted-fg)' }}>{t('stock.receive.needMaterial')}</p>
        <Link href="/inventory/new" className="btn btn-primary">
          <PackagePlus size={16} /> {t('inv.addBtn')}
        </Link>
      </div>
    );
  }

  const [materialId, setMaterialId] = useState<string>('');
  const [qty, setQty] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [note, setNote] = useState('');

  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<string | null>(null);

  const selected = useMemo(
    () => materials.find((m) => m.id === materialId) ?? null,
    [materials, materialId]
  );

  // When material changes, pre-fill unitCost from its lastUnitCost.
  const handlePickMaterial = (id: string) => {
    setMaterialId(id);
    const m = materials.find((x) => x.id === id);
    if (m?.lastUnitCost != null && !unitCost) {
      setUnitCost(String(m.lastUnitCost));
    }
  };

  const filteredMaterials = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return materials;
    return materials.filter((m) => {
      const hay = `${m.name} ${m.nameLocal ?? ''} ${m.code ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [materials, search]);

  const qtyNum = Number(qty) || 0;
  const costNum = Number(unitCost) || 0;
  const total = qtyNum * costNum;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!selected) { setError(t('stock.receive.pickMaterial')); return; }
    if (qtyNum <= 0) { setError(t('stock.receive.qty')); return; }
    // Expiry is always optional now — owner can log a receive with or without it,
    // and the per-material `tracksExpiry` flag is informational only.

    setSaving(true);
    try {
      const res = await fetch('/api/stock/receive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          materialId: selected.id,
          qty: qtyNum,
          unit: selected.baseUnit,
          unitCost: costNum,
          expiryDate: expiryDate ? new Date(expiryDate).toISOString() : null,
          note: note.trim() || null,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || 'Receive failed');
        return;
      }
      // Success — capture the material name for the confirmation view
      setSuccess(selected.name);
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setMaterialId('');
    setQty('');
    setUnitCost('');
    setExpiryDate('');
    setNote('');
    setSearch('');
    setSuccess(null);
    setError('');
  };

  // -----------------------------------------------------------------------
  // Success view — persists until user clears it
  // -----------------------------------------------------------------------
  if (success) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 'var(--space-7) var(--space-5)' }}>
        <CheckCircle2 size={56} style={{ color: 'var(--color-success)', marginBottom: 'var(--space-3)' }} />
        <h2 style={{ margin: 0 }}>{t('stock.receive.success')}</h2>
        <p style={{ color: 'var(--color-foreground)', fontSize: '1.125rem', marginTop: 'var(--space-3)' }}>
          <strong>{success}</strong> +{qtyNum} {selected?.baseUnit} · <MMK amount={total} />
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'center', marginTop: 'var(--space-4)', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary" onClick={reset}>
            <PackagePlus size={16} /> {t('stock.receive.another')}
          </button>
          <Link href="/inventory" className="btn btn-secondary">
            {t('stock.receive.backToList')}
          </Link>
        </div>
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Main form
  // -----------------------------------------------------------------------
  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <header>
        <h1 style={{ marginBottom: 4 }}>{t('stock.receive.title')}</h1>
        <p style={{ color: 'var(--color-muted-fg)', margin: 0, fontSize: '0.9375rem' }}>
          {t('stock.receive.subtitle')}
        </p>
      </header>

      {/* Material picker card */}
      <div className="card" style={{ padding: 'var(--space-4)' }}>
        <label style={{ display: 'block', marginBottom: 'var(--space-2)' }}>
          {t('stock.receive.material')} *
        </label>

        {selected ? (
          // Selected state — compact chip with "change" affordance
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: 'var(--space-3) var(--space-4)',
            background: 'var(--color-background)',
            border: '1px solid var(--color-border-strong)',
            borderRadius: 'var(--radius-sm)',
          }}>
            <div>
              <div style={{ fontWeight: 600 }}>{selected.name}</div>
              {selected.nameLocal && (
                <div lang="my" style={{ color: 'var(--color-muted-fg)', fontSize: '0.875rem' }}>
                  {selected.nameLocal}
                </div>
              )}
              <div style={{ color: 'var(--color-subtle-fg)', fontSize: '0.8125rem', marginTop: 2 }}>
                {selected.category.replace(/_/g, ' ')} · {selected.storageZone} · {t('stock.receive.qty')} in {selected.baseUnit}
              </div>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMaterialId('')}>
              {t('common.edit')}
            </button>
          </div>
        ) : (
          // Search + list
          <>
            <div style={{ position: 'relative', marginBottom: 'var(--space-2)' }}>
              <Search
                size={18}
                style={{
                  position: 'absolute', left: 12, top: '50%',
                  transform: 'translateY(-50%)', color: 'var(--color-subtle-fg)',
                  pointerEvents: 'none',
                }}
              />
              <input
                type="search"
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('stock.receive.searchMat')}
                style={{ paddingLeft: 40 }}
              />
            </div>
            <div style={{
              maxHeight: 320, overflowY: 'auto',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
            }}>
              {filteredMaterials.length === 0 ? (
                <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--color-muted-fg)' }}>
                  {t('inv.noMatches')}
                </div>
              ) : filteredMaterials.map((m) => (
                <button
                  type="button"
                  key={m.id}
                  onClick={() => handlePickMaterial(m.id)}
                  style={{
                    width: '100%', textAlign: 'left',
                    padding: 'var(--space-2) var(--space-3)',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: '1px solid var(--color-border)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    minHeight: 44,
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-surface-alt)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <div>
                    <div style={{ fontWeight: 500 }}>{m.name}</div>
                    {m.nameLocal && (
                      <div lang="my" style={{ color: 'var(--color-muted-fg)', fontSize: '0.8125rem' }}>
                        {m.nameLocal}
                      </div>
                    )}
                  </div>
                  <div style={{ color: 'var(--color-subtle-fg)', fontSize: '0.8125rem' }}>
                    {m.baseUnit}
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Qty + cost + expiry only shown once a material is selected */}
      {selected && (
        <>
          <div className="card" style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div className="form-grid-2" style={{ gap: 'var(--space-3)' }}>
              <div>
                <label>{t('stock.receive.qty')} ({selected.baseUnit}) *</label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.0001"
                  min="0"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  required
                  autoFocus
                />
                <small style={{ color: 'var(--color-muted-fg)' }}>{t('stock.receive.qtyHint')}</small>
              </div>
              <div>
                <label>{t('stock.receive.unitCost')} *</label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="1"
                  min="0"
                  value={unitCost}
                  onChange={(e) => setUnitCost(e.target.value)}
                  required
                />
                {selected.lastUnitCost != null && (
                  <small style={{ color: 'var(--color-muted-fg)' }}>
                    Last: <MMK amount={selected.lastUnitCost} /> / {selected.baseUnit}
                  </small>
                )}
              </div>
            </div>

            {/* Live total */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
              padding: 'var(--space-3) var(--space-4)',
              background: 'var(--color-background)',
              borderRadius: 'var(--radius-sm)',
              border: '1px dashed var(--color-border-strong)',
            }}>
              <span style={{ color: 'var(--color-muted-fg)', fontSize: '0.9375rem' }}>
                {t('stock.receive.totalCost')}
              </span>
              <span style={{ fontSize: '1.375rem', fontWeight: 700, color: 'var(--color-primary)' }}>
                <MMK amount={total} />
              </span>
            </div>

            {/* Expiry — always shown, always optional. Owner can log a
                receive with or without an expiry date for any material. */}
            <div>
              <label>{t('stock.receive.expiryDate')}</label>
              <input
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
              />
              <small style={{ color: 'var(--color-muted-fg)' }}>{t('stock.receive.expiryReq')}</small>
            </div>
          </div>

          {/* Optional note */}
          <div className="card" style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div>
              <label>{t('stock.receive.note')}</label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
              />
            </div>
          </div>
        </>
      )}

      {error && (
        <div role="alert" className="card" style={{
          borderColor: 'var(--color-destructive)',
          color: 'var(--color-destructive)',
          background: 'var(--color-destructive-bg)',
        }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button type="submit" className="btn btn-primary" disabled={saving || !selected || qtyNum <= 0}>
          {saving ? <Check size={16} /> : <Save size={16} />}
          {saving ? t('stock.receive.submitting') : t('stock.receive.submit')}
        </button>
        <Link href="/inventory" className="btn btn-secondary">
          {t('common.cancel')}
        </Link>
      </div>
    </form>
  );
}
