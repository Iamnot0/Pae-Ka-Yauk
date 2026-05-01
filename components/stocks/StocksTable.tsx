'use client';

/**
 * Stocks table — replaces the old card-grid /items view.
 *
 * Goals (owner brief 2026-04-25):
 *   - Single A→Z table that staff can scan at a glance.
 *   - Columns: Name | On-hand | DMG | FOC | Expire | Price | Actions
 *   - DMG and FOC cells are click-to-log: a small dialog asks for qty and
 *     an optional reason, then writes a stock_adjustment + decrements
 *     finishedGoodsOnHand atomically.
 *   - Top-of-page period toggle: Today / This week / All time.
 *   - Search filter for long catalogues.
 *
 * On-hand caveat: only meaningful for BATCH items (bread, cake, etc).
 * DIRECT items (drinks made-to-order) show '—'; you can still log DMG/FOC
 * for a spilled or comped Latte, but there's no shelf count to decrement.
 */

import { useEffect, useMemo, useRef, useState, useTransition, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, Plus, MoreVertical, Settings2, Upload, PackagePlus } from 'lucide-react';
import { useT } from '@/lib/i18n/useT';
import { MMK } from '@/components/i18n/MMK';
import type { StockRow, StockPeriod } from '@/lib/repos/stocks';
import { resolveDisplayCost } from '@/lib/items/cost';
import type { InventoryMode } from '@/lib/featureMode';
import {
  toDisplayCategory,
  displayCategoryDictKey,
  rawCategoriesFor,
  DISPLAY_CATEGORY_ORDER,
  type DisplayCategory,
} from '@/lib/categories';
import { newId } from '@/lib/client/ulid';
import { ReceiveStockModal } from './ReceiveStockModal';

type CategoryFilter = DisplayCategory | 'ALL';

interface Props {
  initial: StockRow[];
  userRole: string;
  mode: InventoryMode;
}

const DAMAGE_REASONS = ['Burnt', 'Dropped', 'Mouldy', 'Wrong shape', 'Other'] as const;
const FOC_REASONS = ['Promo / giveaway', 'Comp customer', 'Staff', 'Other'] as const;

// Role-split visibility: only OWNER and MANAGER see margins (Cost / production
// cost). CASHIER and BAKER see operational columns only — they don't need to
// know per-unit profit, and surfacing it widens the trust surface unnecessarily.
const COST_VISIBLE_ROLES = new Set(['OWNER', 'MANAGER']);

export function StocksTable({ initial, userRole, mode }: Props) {
  const t = useT();
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  // Cost column visibility: role-gated only. Owner/manager always see Cost
  // even if blanks — that visibility is the affordance that prompts the
  // owner to fill in costs via /stocks/[id] Edit. Cashier/baker still hidden
  // (don't need to see margin to ring up sales).
  const showCost = COST_VISIBLE_ROLES.has(userRole);
  const [period, setPeriod] = useState<StockPeriod>('today');
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<CategoryFilter>('ALL');
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<{
    row: StockRow;
    category: 'DAMAGED' | 'FOC';
  } | null>(null);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [preselectedItemId, setPreselectedItemId] = useState<string | undefined>(undefined);

  // Re-fetch when the period changes
  useEffect(() => {
    if (period === 'today' && rows === initial) return; // first paint already covers today
    let cancelled = false;
    fetch(`/api/stocks?period=${period}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d?.rows) setRows(d.rows);
      })
      .catch(() => { /* keep current rows on error */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      // Use reverse lookup so a "Dessert" filter (a super-bucket) matches
      // every BAKERY_* item, not just the literal DESSERT enum.
      if (cat !== 'ALL' && !rawCategoriesFor(cat).includes(r.category)) return false;
      if (!q) return true;
      // Starts-with on name (matches owner's preference for the global search):
      // typing "B" shows items beginning with B, not items containing B mid-word.
      // SKU still uses substring since barcodes are scanned in full.
      return (
        r.name.toLowerCase().startsWith(q) ||
        (r.nameLocal ?? '').toLowerCase().startsWith(q) ||
        (r.sku ?? '').toLowerCase().includes(q)
      );
    });
  }, [rows, query, cat]);

  const refresh = () => {
    startTransition(() => {
      fetch(`/api/stocks?period=${period}`)
        .then((r) => r.json())
        .then((d) => { if (d?.rows) setRows(d.rows); })
        .catch(() => { /* swallow */ });
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* Header — title + create button */}
      <header className="toolbar" style={{ alignItems: 'flex-end', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
        <div>
          <h1 style={{ margin: 0 }}>{t('stocks.title')}</h1>
          <p style={{ color: 'var(--color-muted-fg)', margin: '4px 0 0', fontSize: '0.9375rem' }}>
            {t('stocks.subtitle')}
          </p>
        </div>
        <div className="toolbar">
          <Link href="/stocks/modifiers" className="btn btn-secondary">
            <Settings2 size={16} /> {t('stocks.modifiers')}
          </Link>
          <CsvImportButton onImported={refresh} t={t} />
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => { setPreselectedItemId(undefined); setReceiveOpen(true); }}
          >
            <PackagePlus size={16} /> {t('stocks.btn.receive')}
          </button>
          <Link href="/stocks/new" className="btn btn-primary">
            <Plus size={16} /> {t('stocks.add')}
          </Link>
        </div>
      </header>

      {/* Controls — period toggle + search */}
      <div className="toolbar" style={{ gap: 'var(--space-3)' }}>
        <div style={{ display: 'inline-flex', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border-strong)', overflow: 'hidden' }}>
          {(['today', 'week', 'all'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              style={{
                padding: '8px 14px',
                fontSize: '0.875rem',
                fontWeight: period === p ? 600 : 500,
                background: period === p ? 'var(--color-primary)' : 'var(--color-surface)',
                color: period === p ? '#fff' : 'var(--color-foreground)',
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {t(`stocks.period.${p}`)}
            </button>
          ))}
        </div>
        <div style={{ position: 'relative', flex: 1, minWidth: 200, maxWidth: 360 }}>
          <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-subtle-fg)', pointerEvents: 'none' }} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('common.search')}
            style={{ paddingLeft: 36, minHeight: 40 }}
          />
        </div>
        <select
          value={cat}
          onChange={(e) => setCat(e.target.value as CategoryFilter)}
          aria-label={t('item.category')}
          style={{ minHeight: 40, minWidth: 180 }}
        >
          <option value="ALL">{t('stocks.cat.all')}</option>
          {DISPLAY_CATEGORY_ORDER.map((c) => (
            <option key={c} value={c}>{t(displayCategoryDictKey(c))}</option>
          ))}
        </select>
        {pending && (
          <span style={{ color: 'var(--color-muted-fg)', fontSize: '0.8125rem' }}>{t('common.loading')}</span>
        )}
      </div>

      {/* Table — scroll-inside so the page itself stays compact */}
      <div className="card table-scroll" style={{ padding: 0 }}>
        <table style={{ fontSize: '0.9375rem' }}>
          <thead>
            <tr style={{ background: 'var(--color-surface-alt)', textAlign: 'left' }}>
              <Th>{t('stocks.col.sku')}</Th>
              <Th>{t('stocks.col.name')}</Th>
              <Th>{t('stocks.col.category')}</Th>
              <Th align="right">{t('stocks.col.onHand')}</Th>
              <Th align="right" title={t('stocks.col.stockIn.tooltip')}>{t('stocks.col.stockIn')}</Th>
              <Th align="right">{t('stocks.col.dmg')}</Th>
              <Th align="right">{t('stocks.col.foc')}</Th>
              <Th align="right">{t('stocks.col.expire')}</Th>
              {showCost && <Th align="right">{t('stocks.col.cost')}</Th>}
              <Th align="right">{t('stocks.col.price')}</Th>
              <Th>{t('stocks.col.unit')}</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={showCost ? 12 : 11} style={{ padding: 'var(--space-5)', textAlign: 'center', color: 'var(--color-muted-fg)' }}>
                  {query || cat !== 'ALL' ? t('stocks.noMatch') : t('stocks.empty')}
                </td>
              </tr>
            ) : filtered.map((r) => (
              <tr key={r.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                <Td mono>
                  {r.sku
                    ? <span style={{ fontSize: '0.8125rem', color: 'var(--color-muted-fg)' }}>{r.sku}</span>
                    : <span style={{ color: 'var(--color-subtle-fg)' }}>—</span>}
                </Td>
                <Td>
                  <div style={{ fontWeight: 500 }}>{r.name}</div>
                  {r.nameLocal && (
                    <div lang="my" style={{ color: 'var(--color-muted-fg)', fontSize: '0.8125rem' }}>{r.nameLocal}</div>
                  )}
                  {!r.active && (
                    <span style={{ display: 'inline-block', marginTop: 2, fontSize: '0.6875rem', color: 'var(--color-muted-fg)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Inactive
                    </span>
                  )}
                </Td>
                <Td>
                  <span style={{ fontSize: '0.8125rem', color: 'var(--color-muted-fg)' }}>
                    {t(displayCategoryDictKey(toDisplayCategory(r.category)))}
                  </span>
                </Td>
                <Td align="right" mono>
                  {r.productionMode === 'DIRECT'
                    ? <span style={{ color: 'var(--color-subtle-fg)' }} aria-label="Not tracked">—</span>
                    : (r.onHand == null
                        ? <span style={{ color: 'var(--color-subtle-fg)' }}>—</span>
                        : <strong>{r.onHand}</strong>)}
                </Td>
                <Td align="right" mono>
                  {r.stockInQty == null
                    ? <span style={{ color: 'var(--color-subtle-fg)' }}>—</span>
                    : (
                      <span title={`${t('stocks.col.bakedLabel')}: ${r.bakedQty ?? 0} · ${t('stocks.col.receivedLabel')}: ${r.receivedQty ?? 0}`}>
                        {r.stockInQty}
                      </span>
                    )}
                </Td>
                <CountCell value={r.dmg} onClick={() => setDialog({ row: r, category: 'DAMAGED' })} />
                <CountCell value={r.foc} onClick={() => setDialog({ row: r, category: 'FOC' })} />
                <Td align="right" mono>
                  <ExpireCell days={r.daysUntilExpiry} date={r.expiryDate} t={t} />
                </Td>
                {showCost && (() => {
                  const cost = resolveDisplayCost(
                    { manualCost: r.manualCost ?? null, recipeCost: r.costPerUnit ?? null },
                    mode,
                  );
                  return (
                    <Td align="right" mono>
                      {cost == null
                        ? <span style={{ color: 'var(--color-subtle-fg)' }}>—</span>
                        : <MMK amount={cost} />}
                    </Td>
                  );
                })()}
                <Td align="right" mono>
                  <MMK amount={r.price} />
                </Td>
                <Td>
                  {r.unit
                    ? <span style={{ fontSize: '0.8125rem', color: 'var(--color-muted-fg)' }}>{r.unit}</span>
                    : <span style={{ color: 'var(--color-subtle-fg)' }}>—</span>}
                </Td>
                <Td align="right">
                  {/* Per-row Receive button removed 2026-04-28 — top-of-page
                      "Receive Stocks" already covers this. The Edit link is
                      the only per-row action now. */}
                  <Link
                    href={`/stocks/${r.id}`}
                    aria-label={`Edit ${r.name}`}
                    style={{ display: 'inline-flex', padding: 6, color: 'var(--color-muted-fg)' }}
                  >
                    <MoreVertical size={16} />
                  </Link>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Adjustment dialog */}
      {dialog && (
        <AdjustDialog
          row={dialog.row}
          category={dialog.category}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); refresh(); }}
        />
      )}

      {/* Footer note about Expire */}
      <p style={{ color: 'var(--color-muted-fg)', fontSize: '0.8125rem', margin: 0 }}>
        {t('stocks.expireNote')}
      </p>

      {/* Receive Stocks modal — preselectedItemId set when opened from a row */}
      <ReceiveStockModal
        open={receiveOpen}
        onClose={() => setReceiveOpen(false)}
        onSuccess={() => { router.refresh(); refresh(); }}
        preselectedItemId={preselectedItemId}
        items={rows.map((r) => ({
          id: r.id,
          name: r.name,
          productionMode: r.productionMode,
          manualCost: r.manualCost ?? null,
        }))}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
function Th({ children, align = 'left', title }: { children?: React.ReactNode; align?: 'left' | 'right'; title?: string }) {
  return (
    <th
      title={title}
      style={{
        padding: '10px 12px',
        fontSize: '0.75rem',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: 'var(--color-muted-fg)',
        textAlign: align,
        cursor: title ? 'help' : undefined,
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, align = 'left', mono = false }: { children?: React.ReactNode; align?: 'left' | 'right'; mono?: boolean }) {
  return (
    <td style={{
      padding: '10px 12px',
      textAlign: align,
      fontVariantNumeric: mono ? 'tabular-nums' : undefined,
      verticalAlign: 'top',
    }}>
      {children}
    </td>
  );
}

// ---------------------------------------------------------------------------
// CsvImportButton — single click → file picker → POST → toast result
// ---------------------------------------------------------------------------
function CsvImportButton({ onImported, t }: {
  onImported: () => void;
  t: ReturnType<typeof useT>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ''; // allow re-uploading the same file later
    setBusy(true);
    setToast(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/import/stocks', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast(data?.error || 'Import failed');
        return;
      }
      const created = data.createdCount ?? 0;
      const skipped = Array.isArray(data.skipped) ? data.skipped.length : 0;
      setToast(`Created ${created}, skipped ${skipped}.`);
      onImported();
    } finally {
      setBusy(false);
      setTimeout(() => setToast(null), 5000);
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        onChange={onPick}
        style={{ display: 'none' }}
      />
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        title={t('stocks.import.title')}
      >
        <Upload size={16} /> {busy ? t('stocks.import.busy') : t('stocks.import.button')}
      </button>
      {toast && (
        <div
          role="status"
          style={{
            position: 'fixed', bottom: 24, right: 24,
            padding: '10px 14px',
            background: 'var(--color-foreground)',
            color: 'var(--color-surface)',
            borderRadius: 'var(--radius-md, 8px)',
            boxShadow: 'var(--shadow-md)',
            zIndex: 200,
            fontSize: '0.875rem',
          }}
        >
          {toast}
        </div>
      )}
    </>
  );
}

/**
 * Renders the Expiry column as "1 Day" / "3 Days" / "Expired" / "—".
 * The day count is computed server-side against the tenant's calendar TZ
 * (Asia/Yangon), so refreshing the page on a new day re-renders without
 * a write to the row. Tooltip surfaces the configured ISO date for staff
 * who want to confirm "expires May 4" mentally.
 */
function ExpireCell({
  days, date, t,
}: {
  days: number | null;
  date: string | null;
  t: ReturnType<typeof useT>;
}) {
  if (days == null) return <span style={{ color: 'var(--color-subtle-fg)' }}>—</span>;
  if (days < 0) {
    return (
      <span title={date ?? undefined} style={{ color: 'var(--color-destructive)', fontWeight: 600 }}>
        {t('stocks.expire.expired')}
      </span>
    );
  }
  const label = days === 1 ? t('stocks.expire.day') : t('stocks.expire.days');
  // Highlight imminent expiry (≤ 2 days) in warning color so the staff eye
  // catches "Pull these from the shelf today" without scanning numbers.
  const tint = days <= 2 ? 'var(--color-warning)' : 'var(--color-foreground)';
  return (
    <span title={date ?? undefined} style={{ color: tint, fontWeight: days <= 2 ? 600 : 400 }}>
      {days} {label}
    </span>
  );
}

/** Click-to-log cell — same shape for DMG and FOC columns. */
function CountCell({ value, onClick }: { value: number; onClick: () => void }) {
  const positive = value > 0;
  return (
    <td style={{ padding: 4, textAlign: 'right' }}>
      <button
        type="button"
        onClick={onClick}
        style={{
          minWidth: 56,
          padding: '6px 10px',
          background: positive ? 'var(--color-warning-bg, rgba(234,179,8,0.12))' : 'transparent',
          color: positive ? 'var(--color-foreground)' : 'var(--color-muted-fg)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontVariantNumeric: 'tabular-nums',
          fontWeight: positive ? 600 : 400,
        }}
        aria-label={positive ? `${value} — click to log more` : 'click to log'}
      >
        {positive ? value : '+'}
      </button>
    </td>
  );
}

// ---------------------------------------------------------------------------
// Adjustment dialog — qty + reason + note
// ---------------------------------------------------------------------------
function AdjustDialog({
  row, category, onClose, onSaved,
}: {
  row: StockRow;
  category: 'DAMAGED' | 'FOC';
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const reasons = category === 'DAMAGED' ? DAMAGE_REASONS : FOC_REASONS;
  const [qty, setQty] = useState('1');
  const [reason, setReason] = useState<string>(reasons[0]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Recent-entries panel — show what's already been logged for this item.
  // Filtered client-side to the active tab (DAMAGED vs FOC) so the cashier
  // sees the timeline of the kind they're about to add to.
  type AdjustEntry = {
    id: string;
    category: string;
    qty: number;
    reason: string | null;
    note: string | null;
    createdAt: string;
    byName: string | null;
  };
  const [recent, setRecent] = useState<AdjustEntry[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/stocks/adjust?itemId=${encodeURIComponent(row.id)}&limit=20`);
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) setRecent((data?.rows ?? []) as AdjustEntry[]);
      } catch {
        if (!cancelled) setRecent([]);
      }
    })();
    return () => { cancelled = true; };
  }, [row.id]);

  const recentForTab = (recent ?? []).filter((r) =>
    category === 'DAMAGED'
      ? r.category === 'DAMAGED' || r.category === 'SPOILED'
      : r.category === 'FOC',
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const n = Number(qty);
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
      setError(t('stocks.dialog.qtyError'));
      return;
    }
    setSaving(true);
    try {
      // Client-minted ULID — required by /api/stocks/adjust for idempotent
      // retries (Hard Rule #15). Same id on resubmit = no duplicate row,
      // no double-decrement of finishedGoodsOnHand.
      const res = await fetch('/api/stocks/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: newId(),
          itemId: row.id,
          category,
          qty: n,
          reason: reason || null,
          note: note.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || t('stocks.dialog.saveError'));
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const title = category === 'DAMAGED' ? t('stocks.dialog.damageTitle') : t('stocks.dialog.focTitle');

  return (
    <div role="dialog" aria-modal="true" onClick={onClose} className="modal-overlay">
      <div onClick={(e) => e.stopPropagation()} className="modal-card" style={{ maxWidth: 420 }}>
        <h3 style={{ margin: 0, marginBottom: 4 }}>{title}</h3>
        <p style={{ margin: 0, color: 'var(--color-muted-fg)', fontSize: '0.9375rem' }}>
          {row.name}{row.nameLocal && <span lang="my"> ({row.nameLocal})</span>}
          {row.onHand != null && <> · {t('stocks.col.onHand')} {row.onHand}</>}
        </p>

        {/* Recent entries — newest first, capped at 20. Lets the cashier see
            what's already been logged for this item before adding more. */}
        <div style={{ marginTop: 'var(--space-3)' }}>
          <div style={{
            fontSize: '0.8125rem', fontWeight: 600,
            color: 'var(--color-muted-fg)', marginBottom: 'var(--space-1)',
          }}>
            {category === 'DAMAGED' ? 'Recent damage / spoilage' : 'Recent FOC entries'}
            {recent && <> · {recentForTab.length}</>}
          </div>
          <div style={{
            maxHeight: 140, overflowY: 'auto',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--color-surface-alt)',
            padding: '6px 8px', fontSize: '0.8125rem',
          }}>
            {recent === null && <div style={{ color: 'var(--color-muted-fg)' }}>Loading…</div>}
            {recent !== null && recentForTab.length === 0 && (
              <div style={{ color: 'var(--color-muted-fg)' }}>No entries yet.</div>
            )}
            {recentForTab.map((e) => (
              <div key={e.id} style={{ display: 'flex', gap: 8, padding: '2px 0' }}>
                <span style={{ minWidth: 92, color: 'var(--color-muted-fg)' }}>
                  {new Date(e.createdAt).toLocaleString(undefined, {
                    month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
                  })}
                </span>
                <span style={{ minWidth: 28, fontWeight: 600 }}>{e.qty}</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.reason || '—'}{e.note ? ` · ${e.note}` : ''}
                </span>
                {e.byName && (
                  <span style={{ color: 'var(--color-muted-fg)' }}>{e.byName}</span>
                )}
              </div>
            ))}
          </div>
        </div>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
          <div>
            <label>{t('stocks.dialog.qty')}</label>
            <input
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div>
            <label>{t('stocks.dialog.reason')}</label>
            <select value={reason} onChange={(e) => setReason(e.target.value)}>
              {reasons.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label>{t('stocks.dialog.note')}</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
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
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? t('common.loading') : t('stocks.dialog.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
