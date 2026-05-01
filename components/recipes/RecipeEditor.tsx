'use client';

/**
 * Recipe editor — simplified for bakers & shop owners, not engineers.
 *
 * Design goals (owner brief, 2026-04-25):
 *   1. One batch = one mental unit. Hero input reads "One batch makes [N]",
 *      not the old "yield / yieldUnit / wasteFactor" triple grid.
 *   2. Add an ingredient in ONE click — a search-to-add row sits at the
 *      bottom of the list. Type a few letters, click the match, the row
 *      appears pre-populated. No more "click add → click default → click
 *      change → click material" 3-click dance.
 *   3. Live cost panel shows batch cost, per-piece cost, sell price, and
 *      profit with a friendly verdict (profitable / breakeven / losing).
 *      If any material lacks `lastUnitCost`, there's an inline link to go
 *      fix it on the inventory page — not a cryptic "estimate incomplete".
 *   4. Waste factor + notes live behind a collapsible "Advanced" section.
 *      Most users never open it.
 *
 * The underlying save API (`/api/recipes`) and schema fields are unchanged.
 * This file is purely UX reshaping.
 */

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Save, Trash2, X, Search, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { useT } from '@/lib/i18n/useT';
import { MMK } from '@/components/i18n/MMK';
import { convert, sameDimension } from '@/lib/stock/convert';
import type { SellableItem } from '@/lib/repos/items';
import type { Recipe } from '@/lib/repos/recipes';
import type { RawMaterial, Unit } from '@/lib/repos/materials';

interface Props {
  item: SellableItem;
  recipe: Recipe | null;
  materials: RawMaterial[];
}

// Yield units = what the baker counts at the end of a batch. Menus are sold
// by the piece/box/cup, NOT by weight or volume. Keeping this list count-only
// prevents nonsense like "yield = 7 KG of Latte".
const YIELD_UNITS: Unit[] = ['PCS', 'BOX', 'CUP', 'PACK', 'BOTTLE'];

/** Units that can be entered for an ingredient given the material's base unit.
 *  Keeps the dropdown short and prevents nonsense combinations (e.g. L for flour). */
function compatibleUnits(base: Unit): Unit[] {
  if (base === 'G' || base === 'KG') return ['G', 'KG'];
  if (base === 'ML' || base === 'L') return ['ML', 'L'];
  return [base]; // PCS, BOX, CUP, PACK, CARTON, BOTTLE, CAN — discrete, no auto-convert
}

interface Draft {
  materialId: string;
  quantity: string;
  unit: Unit;
}

export function RecipeEditor({ item, recipe, materials }: Props) {
  const t = useT();
  const router = useRouter();

  const [yieldQty, setYieldQty] = useState<string>(recipe ? String(recipe.yield) : '1');
  const [yieldUnit, setYieldUnit] = useState<Unit>(recipe?.yieldUnit ?? 'PCS');
  const [wastePct, setWastePct] = useState<string>(recipe ? String(recipe.wasteFactor * 100) : '0');
  const [notes, setNotes] = useState(recipe?.notes ?? '');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [ings, setIngs] = useState<Draft[]>(
    recipe
      ? recipe.ingredients.map((i) => ({
          materialId: i.materialId,
          quantity: String(i.quantity),
          unit: i.unit,
        }))
      : []
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const matById = useMemo(() => Object.fromEntries(materials.map((m) => [m.id, m])), [materials]);
  const alreadyAddedIds = useMemo(() => new Set(ings.map((i) => i.materialId)), [ings]);

  // Cost panel: batch cost + per-unit cost + profit vs item.price
  // (item.price is sell price per ONE sellable item; yield is units per batch)
  const costInfo = useMemo(() => {
    const y = Number(yieldQty);
    if (!y || y <= 0) return null;

    let batchCost = 0;
    const missing: Array<{ id: string; name: string }> = [];
    let anyEntered = false;

    for (const ing of ings) {
      const m = matById[ing.materialId];
      const q = Number(ing.quantity);
      if (!m || !q) continue;
      anyEntered = true;
      if (m.lastUnitCost == null) {
        missing.push({ id: m.id, name: m.name });
        continue;
      }
      if (!sameDimension(ing.unit, m.baseUnit)) continue;
      batchCost += convert(q, ing.unit, m.baseUnit) * m.lastUnitCost;
    }

    if (!anyEntered) return null;

    const perUnit = batchCost / y;
    const profit = item.price - perUnit;
    const margin = item.price > 0 ? (profit / item.price) * 100 : 0;
    return { batchCost, perUnit, profit, margin, missing };
  }, [ings, yieldQty, matById, item.price]);

  // Focus the qty input of newly added rows (queued via ref + effect so the
  // DOM has a chance to render the new row before we call focus()).
  const pendingFocusIdx = useRef<number | null>(null);
  const qtyRefs = useRef<Record<number, HTMLInputElement | null>>({});
  useEffect(() => {
    const idx = pendingFocusIdx.current;
    if (idx == null) return;
    const el = qtyRefs.current[idx];
    if (el) el.focus();
    pendingFocusIdx.current = null;
  }, [ings.length]);

  const addMaterial = (materialId: string) => {
    const m = matById[materialId];
    if (!m) return;
    setIngs((prev) => {
      const next = [...prev, { materialId, quantity: '', unit: m.baseUnit }];
      pendingFocusIdx.current = next.length - 1;
      return next;
    });
  };

  const updateIng = (idx: number, patch: Partial<Draft>) =>
    setIngs((prev) => prev.map((ing, i) => (i === idx ? { ...ing, ...patch } : ing)));

  const removeIng = (idx: number) =>
    setIngs((prev) => prev.filter((_, i) => i !== idx));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (ings.length === 0) { setError(t('rec.noIngredients')); return; }
    const y = Number(yieldQty);
    if (!y || y <= 0) { setError('Yield must be positive'); return; }
    for (const ing of ings) {
      const q = Number(ing.quantity);
      if (!ing.materialId) { setError('Every ingredient needs a material'); return; }
      if (!q || q <= 0) { setError('Every ingredient needs a positive quantity'); return; }
    }

    setSaving(true);
    try {
      const res = await fetch('/api/recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: item.id,
          yield: y,
          yieldUnit,
          wasteFactor: Math.max(0, Math.min(1, Number(wastePct) / 100 || 0)),
          notes: notes.trim() || null,
          ingredients: ings.map((ing, sortOrder) => ({
            materialId: ing.materialId,
            quantity: Number(ing.quantity),
            unit: ing.unit,
            note: null,
            sortOrder,
          })),
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || 'Save failed');
        return;
      }
      router.push('/recipes');
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(t('rec.deleteConfirm'))) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/recipes?itemId=${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      if (!res.ok) { setError('Delete failed'); return; }
      router.push('/recipes');
      router.refresh();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* Item header */}
      <header>
        <h1 style={{ marginBottom: 4 }}>{t('rec.editTitle')}{item.name}</h1>
        {item.nameLocal && (
          <p lang="my" style={{ color: 'var(--color-muted-fg)', margin: 0, fontSize: '0.9375rem' }}>
            {item.nameLocal}
          </p>
        )}
        <p style={{ color: 'var(--color-muted-fg)', margin: '6px 0 0', fontSize: '0.875rem' }}>
          {item.category.replace(/_/g, ' ').toLowerCase()} · <MMK amount={item.price} /> · {item.productionMode}
          {!recipe && <> · <span style={{ color: 'var(--color-warning)' }}>{t('rec.noRecipeYet')}</span></>}
        </p>
      </header>

      {/* ── HERO: batch yield ─────────────────────────────── */}
      <div className="card" style={{ padding: 'var(--space-5)', background: 'linear-gradient(135deg, var(--color-surface) 0%, var(--color-surface-alt) 100%)' }}>
        <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-muted-fg)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 'var(--space-2)' }}>
          {t('rec.batchMakes')}
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="number"
            inputMode="decimal"
            step="any"
            min="0.01"
            value={yieldQty}
            onChange={(e) => setYieldQty(e.target.value)}
            required
            style={{
              fontSize: '2rem',
              fontWeight: 700,
              width: 140,
              minHeight: 56,
              textAlign: 'center',
            }}
          />
          <select
            value={yieldUnit}
            onChange={(e) => setYieldUnit(e.target.value as Unit)}
            style={{ fontSize: '1.125rem', minHeight: 56, minWidth: 110 }}
          >
            {/* Include the saved value first if it's a legacy weight/volume
                unit no longer in YIELD_UNITS — keeps old recipes displayable
                until someone re-saves with a count unit. */}
            {!YIELD_UNITS.includes(yieldUnit) && (
              <option value={yieldUnit}>{yieldUnit} (legacy)</option>
            )}
            {YIELD_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <div style={{ color: 'var(--color-muted-fg)', fontSize: '0.9375rem' }}>
            of {item.name}{item.nameLocal && <span lang="my"> ({item.nameLocal})</span>}
          </div>
        </div>
      </div>

      {/* ── INGREDIENTS ───────────────────────────────────── */}
      <div className="card" style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <h3 style={{ margin: 0 }}>{t('rec.ingredientsPerBatch')}</h3>

        {materials.length === 0 ? (
          <div style={{ color: 'var(--color-muted-fg)', textAlign: 'center', padding: 'var(--space-4)' }}>
            {t('rec.noMaterialsYet')}
          </div>
        ) : (
          <>
            {ings.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {ings.map((ing, idx) => {
                  const m = matById[ing.materialId];
                  if (!m) return null;
                  return (
                    <IngredientRow
                      key={`${ing.materialId}-${idx}`}
                      draft={ing}
                      material={m}
                      qtyRef={(el) => { qtyRefs.current[idx] = el; }}
                      onChange={(patch) => updateIng(idx, patch)}
                      onRemove={() => removeIng(idx)}
                    />
                  );
                })}
              </div>
            )}

            {/* Search-to-add — single input, no "add empty row" button */}
            <MaterialSearchAdd
              materials={materials.filter((m) => !alreadyAddedIds.has(m.id))}
              onPick={addMaterial}
              placeholder={t('rec.searchToAdd')}
            />
          </>
        )}
      </div>

      {/* ── COST PANEL ────────────────────────────────────── */}
      {costInfo && <CostPanel info={costInfo} item={item} yieldUnit={yieldUnit} t={t} />}

      {/* ── ADVANCED (collapsible) ─────────────────────────── */}
      <div>
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          className="btn btn-ghost btn-sm"
          style={{ color: 'var(--color-muted-fg)' }}
        >
          {advancedOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {t('rec.advancedOptions')}
        </button>
        {advancedOpen && (
          <div className="card" style={{ padding: 'var(--space-4)', marginTop: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div>
              <label>{t('rec.wasteFactor')}</label>
              <input
                type="number"
                inputMode="decimal"
                step="0.5"
                min="0"
                max="100"
                value={wastePct}
                onChange={(e) => setWastePct(e.target.value)}
                placeholder="0"
              />
              <small style={{ color: 'var(--color-muted-fg)' }}>{t('rec.wasteHint')}</small>
            </div>
            <div>
              <label>{t('rec.notes')}</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={1000}
              />
            </div>
          </div>
        )}
      </div>

      {error && (
        <div role="alert" className="card" style={{
          borderColor: 'var(--color-destructive)',
          color: 'var(--color-destructive)',
          background: 'var(--color-destructive-bg)',
        }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="submit" className="btn btn-primary" disabled={saving || ings.length === 0}>
          <Save size={16} /> {saving ? t('rec.saving') : t('rec.save')}
        </button>
        <Link href="/recipes" className="btn btn-secondary">{t('common.cancel')}</Link>
        {recipe && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="btn btn-ghost"
            style={{ marginLeft: 'auto', color: 'var(--color-destructive)' }}
          >
            <Trash2 size={16} /> {t('rec.deleteBtn')}
          </button>
        )}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// MaterialSearchAdd — one input, pick-to-add, 1 click per ingredient
// ---------------------------------------------------------------------------
function MaterialSearchAdd({
  materials, onPick, placeholder,
}: {
  materials: RawMaterial[];
  onPick: (materialId: string) => void;
  placeholder: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return materials.slice(0, 8);
    return materials
      .filter((m) =>
        m.name.toLowerCase().includes(q) || (m.nameLocal ?? '').toLowerCase().includes(q)
      )
      .slice(0, 10);
  }, [materials, query]);

  const pick = (id: string) => {
    onPick(id);
    setQuery('');
    setOpen(false);
    // Keep focus on the search input so the user can add another material immediately
    inputRef.current?.blur();
  };

  if (materials.length === 0) {
    return (
      <div style={{ color: 'var(--color-muted-fg)', fontSize: '0.8125rem', padding: '6px 0' }}>
        All materials already added.
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <Search size={16} style={{
          position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
          color: 'var(--color-subtle-fg)', pointerEvents: 'none',
        }} />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder}
          style={{ paddingLeft: 36, minHeight: 44 }}
        />
      </div>

      {open && filtered.length > 0 && (
        <div
          className="dropdown-panel"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border-strong)',
            borderRadius: 'var(--radius-sm)',
            boxShadow: 'var(--shadow-md)',
            zIndex: 20,
            maxHeight: 320,
            overflowY: 'auto',
          }}
        >
          {filtered.map((m) => (
            <button
              type="button"
              key={m.id}
              // onMouseDown fires BEFORE onBlur — prevents the blur-close from
              // killing the click before it registers.
              onMouseDown={(e) => { e.preventDefault(); pick(m.id); }}
              style={{
                width: '100%', textAlign: 'left',
                padding: '10px 14px',
                background: 'transparent',
                border: 'none',
                borderBottom: '1px solid var(--color-border)',
                cursor: 'pointer',
                fontFamily: 'inherit',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                gap: 'var(--space-2)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-surface-alt)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <span>
                <div style={{ fontWeight: 500, fontSize: '0.9375rem' }}>{m.name}</div>
                {m.nameLocal && (
                  <div lang="my" style={{ color: 'var(--color-muted-fg)', fontSize: '0.75rem' }}>
                    {m.nameLocal}
                  </div>
                )}
              </span>
              <span style={{ color: 'var(--color-subtle-fg)', fontSize: '0.75rem' }}>{m.baseUnit}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// IngredientRow — qty + unit + remove (material is fixed; chosen at add time)
// ---------------------------------------------------------------------------
function IngredientRow({
  draft, material, qtyRef, onChange, onRemove,
}: {
  draft: Draft;
  material: RawMaterial;
  qtyRef: (el: HTMLInputElement | null) => void;
  onChange: (patch: Partial<Draft>) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const units = compatibleUnits(material.baseUnit);
  const unitMismatch = !sameDimension(draft.unit, material.baseUnit);
  const noCost = material.lastUnitCost == null;

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) 100px 90px 40px',
      gap: 'var(--space-2)',
      alignItems: 'center',
      padding: 'var(--space-2) var(--space-3)',
      background: 'var(--color-background)',
      borderRadius: 'var(--radius-sm)',
      border: unitMismatch
        ? '1px solid var(--color-destructive)'
        : '1px solid var(--color-border)',
    }}>
      {/* Material (fixed label, no picker) */}
      <div>
        <div style={{ fontWeight: 500, fontSize: '0.9375rem' }}>{material.name}</div>
        {material.nameLocal && (
          <div lang="my" style={{ color: 'var(--color-muted-fg)', fontSize: '0.75rem' }}>
            {material.nameLocal}
          </div>
        )}
        {noCost && (
          <div style={{
            color: 'var(--color-warning)', fontSize: '0.75rem',
            display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 2,
          }}>
            <AlertCircle size={12} />
            <span>{t('rec.noCostYet')}</span>
            <Link
              href={`/inventory/${material.id}`}
              style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}
            >
              {t('rec.setMaterialCost')}
            </Link>
          </div>
        )}
      </div>

      <input
        ref={qtyRef}
        type="number"
        inputMode="decimal"
        step="any"
        min="0"
        value={draft.quantity}
        onChange={(e) => onChange({ quantity: e.target.value })}
        placeholder="0"
        style={{ minHeight: 42, textAlign: 'center', fontWeight: 500 }}
        aria-label={`Quantity for ${material.name}`}
      />

      <select
        value={draft.unit}
        onChange={(e) => onChange({ unit: e.target.value as Unit })}
        style={{ minHeight: 42 }}
        aria-label={`Unit for ${material.name}`}
      >
        {units.map((u) => <option key={u} value={u}>{u}</option>)}
      </select>

      <button
        type="button"
        onClick={onRemove}
        className="btn btn-ghost btn-sm"
        style={{ minHeight: 42, color: 'var(--color-destructive)' }}
        aria-label={`Remove ${material.name}`}
      >
        <X size={16} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CostPanel — batch / per-unit / profit verdict + missing-cost fix-ups
// ---------------------------------------------------------------------------
function CostPanel({ info, item, yieldUnit, t }: {
  info: { batchCost: number; perUnit: number; profit: number; margin: number; missing: Array<{ id: string; name: string }> };
  item: SellableItem;
  yieldUnit: Unit;
  t: ReturnType<typeof useT>;
}) {
  const incomplete = info.missing.length > 0;
  const breakeven = !incomplete && Math.abs(info.profit) < 1;
  const profitable = !incomplete && info.profit > 0 && !breakeven;
  const losing = !incomplete && info.profit < 0;

  return (
    <div className="card" style={{
      padding: 'var(--space-4)',
      borderColor: 'var(--color-accent)',
    }}>
      <div style={{
        fontSize: '0.875rem', fontWeight: 600,
        color: 'var(--color-muted-fg)',
        textTransform: 'uppercase', letterSpacing: '0.06em',
        marginBottom: 'var(--space-3)',
      }}>
        {t('rec.costCheck')}
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        rowGap: 6,
        columnGap: 'var(--space-3)',
        fontSize: '0.9375rem',
      }}>
        <span style={{ color: 'var(--color-muted-fg)' }}>{t('rec.batchCost')}</span>
        <span style={{ textAlign: 'right' }} className="tabular-nums">
          <MMK amount={info.batchCost} />
        </span>

        <span style={{ color: 'var(--color-muted-fg)' }}>{t('rec.perUnitCost')}</span>
        <span style={{ textAlign: 'right' }} className="tabular-nums">
          <MMK amount={info.perUnit} /> <span style={{ color: 'var(--color-muted-fg)', fontSize: '0.8125rem' }}>/ {yieldUnit}</span>
        </span>

        <span style={{ color: 'var(--color-muted-fg)' }}>{t('rec.sellPrice')}</span>
        <span style={{ textAlign: 'right' }} className="tabular-nums">
          <MMK amount={item.price} /> <span style={{ color: 'var(--color-muted-fg)', fontSize: '0.8125rem' }}>/ {yieldUnit}</span>
        </span>

        <span style={{ fontWeight: 700 }}>{t('rec.profitPerUnit')}</span>
        <span
          className="tabular-nums"
          style={{
            textAlign: 'right',
            fontWeight: 700,
            color: profitable ? 'var(--color-success)'
                 : losing ? 'var(--color-destructive)'
                 : 'var(--color-muted-fg)',
          }}
        >
          <MMK amount={info.profit} /> <span style={{ fontSize: '0.8125rem', fontWeight: 500 }}>/ {yieldUnit}</span> ({info.margin.toFixed(1)}%)
        </span>
      </div>

      {/* Verdict banner */}
      {profitable && (
        <div style={{
          marginTop: 'var(--space-3)',
          padding: '8px 12px',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--color-success-bg, rgba(34, 197, 94, 0.12))',
          color: 'var(--color-success)',
          fontSize: '0.875rem', fontWeight: 500,
        }}>
          ✓ {t('rec.profitable')}
        </div>
      )}
      {breakeven && (
        <div style={{
          marginTop: 'var(--space-3)',
          padding: '8px 12px',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--color-surface-alt)',
          color: 'var(--color-muted-fg)',
          fontSize: '0.875rem',
        }}>
          {t('rec.breakeven')}
        </div>
      )}
      {losing && (
        <div style={{
          marginTop: 'var(--space-3)',
          padding: '8px 12px',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--color-destructive-bg)',
          color: 'var(--color-destructive)',
          fontSize: '0.875rem', fontWeight: 500,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <AlertCircle size={14} /> {t('rec.losingMoney')}
        </div>
      )}
      {incomplete && (
        <div style={{
          marginTop: 'var(--space-3)',
          padding: '8px 12px',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--color-warning-bg, rgba(234, 179, 8, 0.12))',
          color: 'var(--color-warning)',
          fontSize: '0.8125rem',
          display: 'flex', alignItems: 'flex-start', gap: 6,
        }}>
          <AlertCircle size={14} style={{ marginTop: 2 }} />
          <span>
            {t('rec.missingCosts')}{' '}
            {info.missing.map((m, i) => (
              <span key={m.id}>
                <Link
                  href={`/inventory/${m.id}`}
                  style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}
                >
                  {m.name}
                </Link>
                {i < info.missing.length - 1 ? ', ' : ''}
              </span>
            ))}
          </span>
        </div>
      )}
    </div>
  );
}
