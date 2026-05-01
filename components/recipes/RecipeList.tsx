'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, Edit3, Trash2, Plus, BookOpen, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useT } from '@/lib/i18n/useT';
import { MMK } from '@/components/i18n/MMK';
import { convert, sameDimension } from '@/lib/stock/convert';
import type { SellableItem } from '@/lib/repos/items';
import type { Recipe } from '@/lib/repos/recipes';
import type { Unit } from '@/lib/repos/materials';

interface Props {
  items: SellableItem[];
  recipes: Record<string, Recipe>;
  matCosts: Record<string, { baseUnit: Unit; lastUnitCost: number | null }>;
}

export function RecipeList({ items, recipes, matCosts }: Props) {
  const t = useT();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  // Inline delete — confirms, fetches, then refreshes the server component
  // that feeds this list. No navigation needed.
  const handleDelete = async (itemId: string, itemName: string) => {
    if (!confirm(t('rec.deleteConfirm'))) return;
    setDeletingId(itemId);
    setError('');
    try {
      const res = await fetch(`/api/recipes?itemId=${encodeURIComponent(itemId)}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || `Delete failed for ${itemName}`);
        return;
      }
      router.refresh();
    } finally {
      setDeletingId(null);
    }
  };

  // Compute cost per serving for each item that has a recipe.
  // Formula: Σ (ingredient qty in material baseUnit × lastUnitCost) / yield
  const costByItem = useMemo(() => {
    const out: Record<string, number | null> = {};
    for (const [itemId, recipe] of Object.entries(recipes)) {
      let batchCost = 0;
      let complete = true;
      for (const ing of recipe.ingredients) {
        const mat = matCosts[ing.materialId];
        if (!mat || mat.lastUnitCost == null) { complete = false; break; }
        if (!sameDimension(ing.unit, mat.baseUnit)) { complete = false; break; }
        const qtyInBase = convert(ing.quantity, ing.unit, mat.baseUnit);
        batchCost += qtyInBase * mat.lastUnitCost;
      }
      out[itemId] = complete ? batchCost / recipe.yield : null;
    }
    return out;
  }, [recipes, matCosts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) =>
      i.name.toLowerCase().includes(q) ||
      (i.nameLocal ?? '').toLowerCase().includes(q)
    );
  }, [items, search]);

  const withRecipe = items.filter((i) => recipes[i.id]).length;
  const itemsWithoutRecipe = useMemo(
    () => items.filter((i) => !recipes[i.id]),
    [items, recipes]
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>{t('rec.title')}</h1>
          <p style={{ color: 'var(--color-muted-fg)', margin: 0, fontSize: '0.9375rem' }}>
            {withRecipe} / {items.length} defined · {t('rec.subtitle')}
          </p>
        </div>
        {itemsWithoutRecipe.length > 0 && (
          <AddRecipeShortcut items={itemsWithoutRecipe} label={t('rec.addShortcut')} hint={t('rec.addShortcutHint')} />
        )}
      </header>

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

      {/* Search */}
      <div style={{ position: 'relative' }}>
        <Search size={18} style={{
          position: 'absolute', left: 14, top: '50%',
          transform: 'translateY(-50%)', color: 'var(--color-subtle-fg)',
          pointerEvents: 'none',
        }} />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('inv.search.placeholder')}
          style={{ paddingLeft: 44 }}
        />
      </div>

      {items.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-6)' }}>
          <BookOpen size={40} style={{ color: 'var(--color-subtle-fg)', marginBottom: 'var(--space-3)' }} />
          <p style={{ color: 'var(--color-muted-fg)', marginBottom: 'var(--space-3)' }}>{t('rec.empty')}</p>
          <Link href="/stocks/new" className="btn btn-primary">{t('item.add')}</Link>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-5)', color: 'var(--color-muted-fg)' }}>
          {t('rec.noMatches')}
        </div>
      ) : (
        <div className="card table-scroll" style={{ padding: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
              <thead>
                <tr style={{ background: 'var(--color-surface-alt)' }}>
                  <Th>{t('rec.th.item')}</Th>
                  <Th>{t('rec.th.status')}</Th>
                  <Th className="num">{t('rec.th.ingredients')}</Th>
                  <Th className="num">{t('rec.th.yield')}</Th>
                  <Th className="num">{t('rec.th.cost')}</Th>
                  <Th style={{ width: 180 }}>{t('rec.th.actions')}</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const recipe = recipes[item.id];
                  const cost = costByItem[item.id];
                  const has = !!recipe;
                  return (
                    <tr key={item.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                      <Td>
                        <div style={{ fontWeight: 500 }}>{item.name}</div>
                        {item.nameLocal && (
                          <div lang="my" style={{ color: 'var(--color-muted-fg)', fontSize: '0.8125rem' }}>
                            {item.nameLocal}
                          </div>
                        )}
                      </Td>
                      <Td>
                        {has ? (
                          <span className="pill" style={{
                            background: '#E8F4E8', color: '#2F6B2F',
                            border: '1px solid #5AA65A',
                            fontWeight: 600,
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                          }}>
                            <CheckCircle2 size={12} /> {t('rec.status.ok')}
                          </span>
                        ) : (
                          <span className="pill" style={{
                            background: '#FFF4DB', color: '#8A6508',
                            border: '1px solid #D4A843',
                            fontWeight: 600,
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                          }}>
                            <AlertTriangle size={12} /> {t('rec.status.missing')}
                          </span>
                        )}
                      </Td>
                      <Td className="num tabular-nums">
                        {has ? recipe.ingredients.length : '—'}
                      </Td>
                      <Td className="num tabular-nums">
                        {has ? `${recipe.yield} ${recipe.yieldUnit}` : '—'}
                      </Td>
                      <Td className="num tabular-nums">
                        {cost != null
                          ? <MMK amount={cost} />
                          : has
                            ? <span title="Missing last-cost on one or more ingredients" style={{ color: 'var(--color-muted-fg)' }}>—</span>
                            : '—'}
                      </Td>
                      <Td>
                        {has ? (
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-start' }}>
                            <Link
                              href={`/recipes/${item.id}` as unknown as never}
                              className="btn btn-ghost btn-sm"
                              style={{ minHeight: 32, padding: '4px 10px' }}
                              aria-label={`${t('rec.editBtn')} ${item.name}`}
                              title={t('rec.editBtn')}
                            >
                              <Edit3 size={14} />
                            </Link>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => handleDelete(item.id, item.name)}
                              disabled={deletingId === item.id}
                              style={{ minHeight: 32, padding: '4px 10px', color: 'var(--color-destructive)' }}
                              aria-label={`${t('rec.deleteBtn')} ${item.name}`}
                              title={t('rec.deleteBtn')}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ) : (
                          <Link
                            href={`/recipes/${item.id}` as unknown as never}
                            className="btn btn-primary btn-sm"
                            style={{ minHeight: 32, padding: '6px 12px', fontWeight: 600 }}
                            aria-label={`${t('rec.addBtn')} — ${item.name}`}
                          >
                            <Plus size={14} /> {t('rec.addBtn')}
                          </Link>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
        </div>
      )}
    </div>
  );
}

/**
 * Header-right dropdown listing items that still lack a recipe. Clicking one
 * routes straight to that item's editor — saves hunting through the table.
 * Auto-hides itself when every item already has a recipe.
 */
function AddRecipeShortcut({ items, label, hint }: { items: SellableItem[]; label: string; hint: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="btn btn-primary"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Plus size={16} /> {label} ({items.length})
      </button>
      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 10 }}
            aria-hidden="true"
          />
          <div
            role="listbox"
            style={{
              position: 'absolute', top: 'calc(100% + 6px)', right: 0,
              width: 280, maxHeight: 360, overflowY: 'auto',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border-strong)',
              borderRadius: 'var(--radius-sm)',
              boxShadow: 'var(--shadow-md)',
              zIndex: 20,
            }}
          >
            <div style={{ padding: '8px 12px', fontSize: '0.75rem', color: 'var(--color-muted-fg)', borderBottom: '1px solid var(--color-border)' }}>
              {hint}
            </div>
            {items.map((it) => (
              <Link
                key={it.id}
                href={`/recipes/${it.id}` as unknown as never}
                onClick={() => setOpen(false)}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '10px 12px',
                  borderBottom: '1px solid var(--color-border)',
                  color: 'var(--color-foreground)', textDecoration: 'none',
                  minHeight: 44,
                }}
              >
                <div>
                  <div style={{ fontWeight: 500, fontSize: '0.9375rem' }}>{it.name}</div>
                  {it.nameLocal && (
                    <div lang="my" style={{ color: 'var(--color-muted-fg)', fontSize: '0.75rem' }}>
                      {it.nameLocal}
                    </div>
                  )}
                </div>
                <Plus size={16} style={{ color: 'var(--color-primary)' }} />
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Th({ children, className = '', style }: { children?: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <th
      className={className}
      style={{
        textAlign: className.includes('num') ? 'right' : 'left',
        padding: 'var(--space-3) var(--space-4)',
        fontSize: '0.75rem',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: 'var(--color-muted-fg)',
        fontWeight: 700,
        ...style,
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, className = '', style }: { children?: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <td
      className={className}
      style={{
        textAlign: className.includes('num') ? 'right' : 'left',
        padding: 'var(--space-3) var(--space-4)',
        color: 'var(--color-foreground)',
        ...style,
      }}
    >
      {children}
    </td>
  );
}
