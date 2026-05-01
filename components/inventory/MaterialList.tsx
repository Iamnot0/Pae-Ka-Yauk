'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, Plus, Upload, Edit3, Trash2, Package, PackagePlus, AlertTriangle, CircleDot } from 'lucide-react';
import { useT } from '@/lib/i18n/useT';
import type { RawMaterial, MaterialCategory, StorageZone } from '@/lib/repos/materials';
import { WasteModal } from './WasteModal';
import type { OnHandSnapshot, StockStatus } from '@/lib/stock/ledger';
import type { DictKey } from '@/lib/i18n/dict';

interface Props {
  materials: RawMaterial[];
  snapshots: Record<string, OnHandSnapshot>;
}

// Status visuals — use theme-aware CSS tokens so light pastels in light mode
// become translucent-dark accents in dark mode automatically. Hardcoded
// hex pastels used to make dark-mode text unreadable.
const STATUS_STYLE: Record<StockStatus, { bg: string; fg: string; border: string; dictKey: DictKey; order: number }> = {
  EXPIRED:  { bg: 'var(--color-destructive-bg)', fg: 'var(--color-destructive)', border: 'var(--color-destructive)', dictKey: 'inv.status.expired',  order: 0 },
  OUT:      { bg: 'var(--color-destructive-bg)', fg: 'var(--color-destructive)', border: 'var(--color-destructive)', dictKey: 'inv.status.out',      order: 1 },
  LOW:      { bg: 'var(--color-warning-bg)',     fg: 'var(--color-warning)',     border: 'var(--color-warning)',     dictKey: 'inv.status.low',      order: 2 },
  EXPIRING: { bg: 'var(--color-info-bg)',        fg: 'var(--color-info)',        border: 'var(--color-info)',        dictKey: 'inv.status.expiring', order: 3 },
  OK:       { bg: 'var(--color-success-bg)',     fg: 'var(--color-success)',     border: 'var(--color-success)',     dictKey: 'inv.status.ok',       order: 4 },
};

const CATEGORY_LABEL: Record<MaterialCategory, { en: string; my: string }> = {
  FLOUR_LEAVENING: { en: 'Flour', my: 'မုန့်ညက်' },
  FAT_OIL:         { en: 'Fat/Oil', my: 'ဆီ' },
  DAIRY:           { en: 'Dairy', my: 'နို့ထွက်' },
  SWEETENER:       { en: 'Sweet', my: 'သကြား' },
  FRUIT_FILLING:   { en: 'Fruit', my: 'အသီး' },
  CHOCOLATE_NUT:   { en: 'Choc/Nut', my: 'ချောကလက်' },
  PROTEIN_SAVORY:  { en: 'Protein', my: 'အသား' },
  SAUCE_SEASONING: { en: 'Sauce', my: 'ဆော့စ်' },
  COLOR_FLAVOR:    { en: 'Color', my: 'အရောင်' },
  BEVERAGE_BASE:   { en: 'Beverage', my: 'အဖျော်' },
  PACKAGING:       { en: 'Packaging', my: 'ထုပ်ပိုး' },
  OTHER:           { en: 'Other', my: 'အခြား' },
};

const ZONE_COLOR: Record<StorageZone, string> = {
  COLD:     'var(--color-info)',
  DRY:      'var(--color-warning)',
  SUPPLIES: 'var(--color-muted-fg)',
};

const ZONE_LABEL: Record<StorageZone, string> = {
  COLD: 'Cold',
  DRY: 'Dry',
  SUPPLIES: 'Supplies',
};

export function MaterialList({ materials, snapshots }: Props) {
  const t = useT();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState<MaterialCategory | 'ALL'>('ALL');
  const [zone, setZone] = useState<StorageZone | 'ALL'>('ALL');
  const [status, setStatus] = useState<StockStatus | 'ALL'>('ALL');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [wasteOpen, setWasteOpen] = useState(false);
  const [wastePreselect, setWastePreselect] = useState<string | undefined>(undefined);

  const handleDelete = async (id: string, name: string) => {
    const msg = t('inv.deleteConfirm').replace('{name}', name);
    if (!confirm(msg)) return;
    setDeletingId(id);
    setError('');
    try {
      const res = await fetch(`/api/materials/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || `Delete failed for ${name}`);
        return;
      }
      router.refresh();
    } finally {
      setDeletingId(null);
    }
  };

  // Fallback snapshot for any material missing from the map (defensive —
  // shouldn't happen, but keeps the UI robust if the parent ever passes
  // an incomplete map)
  const snap = (id: string): OnHandSnapshot =>
    snapshots[id] ?? { onHand: 0, status: 'OUT', nearestExpiry: null };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return materials.filter(m => {
      if (cat !== 'ALL' && m.category !== cat) return false;
      if (zone !== 'ALL' && m.storageZone !== zone) return false;
      if (status !== 'ALL' && snap(m.id).status !== status) return false;
      if (q) {
        const hay = `${m.name} ${m.nameLocal ?? ''} ${m.code ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [materials, snapshots, search, cat, zone, status]);

  // Count by status — for the filter chips and the hero strip
  const statusCounts = useMemo(() => {
    const c: Record<StockStatus, number> = { OK: 0, LOW: 0, OUT: 0, EXPIRING: 0, EXPIRED: 0 };
    for (const m of materials) c[snap(m.id).status]++;
    return c;
  }, [materials, snapshots]);

  const needsAttention = statusCounts.EXPIRED + statusCounts.OUT + statusCounts.LOW + statusCounts.EXPIRING;

  // Category chip list (only show chips for categories that have materials)
  const catCounts = useMemo(() => {
    const m = new Map<MaterialCategory, number>();
    for (const x of materials) m.set(x.category, (m.get(x.category) ?? 0) + 1);
    return m;
  }, [materials]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>{t('inv.rawMaterials')}</h1>
          <p style={{ color: 'var(--color-muted-fg)', margin: 0 }}>
            {materials.length} {t('inv.total')}
            {filtered.length !== materials.length ? ` · ${filtered.length} ${t('inv.shown')}` : ''}
            {needsAttention > 0 && (
              <>
                {' · '}
                <span style={{ color: STATUS_STYLE.LOW.fg, fontWeight: 600 }}>
                  <AlertTriangle size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                  {needsAttention} need attention
                </span>
              </>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <Link href="/inventory/import" className="btn btn-secondary">
            <Upload size={16} /> {t('inv.importBtn')}
          </Link>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => { setWastePreselect(undefined); setWasteOpen(true); }}
          >
            <Trash2 size={16} /> {t('inv.wasteBtn')}
          </button>
          <Link href="/inventory/receive" className="btn btn-secondary">
            <PackagePlus size={16} /> {t('inv.receiveBtn')}
          </Link>
          <Link href="/inventory/new" className="btn btn-primary">
            <Plus size={16} /> {t('inv.addBtn')}
          </Link>
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

      {/* Search */}
      <div style={{ position: 'relative' }}>
        <Search size={18} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-subtle-fg)', pointerEvents: 'none' }} />
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('inv.search.placeholder')}
          style={{ paddingLeft: 44 }}
        />
      </div>

      {/* Filter chips */}
      {/* Status filter — first chip row so attention-needed is top of mind */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center' }}>
        <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-muted-fg)', marginRight: 'var(--space-1)' }}>{t('inv.th.status')}:</span>
        <Chip active={status === 'ALL'} onClick={() => setStatus('ALL')}>
          {t('inv.filter.all')} ({materials.length})
        </Chip>
        {(['EXPIRED', 'OUT', 'LOW', 'EXPIRING', 'OK'] as StockStatus[])
          .filter((s) => statusCounts[s] > 0)
          .map((s) => (
            <Chip
              key={s}
              active={status === s}
              onClick={() => setStatus(s)}
              color={STATUS_STYLE[s].border}
            >
              {t(STATUS_STYLE[s].dictKey)} ({statusCounts[s]})
            </Chip>
          ))}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center' }}>
        <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-muted-fg)', marginRight: 'var(--space-1)' }}>{t('inv.filter.zone')}:</span>
        <Chip active={zone === 'ALL'}      onClick={() => setZone('ALL')}>{t('inv.filter.all')}</Chip>
        <Chip active={zone === 'COLD'}     onClick={() => setZone('COLD')}     color={ZONE_COLOR.COLD}>{t('inv.storageZone.cold')}</Chip>
        <Chip active={zone === 'DRY'}      onClick={() => setZone('DRY')}      color={ZONE_COLOR.DRY}>{t('inv.storageZone.dry')}</Chip>
        <Chip active={zone === 'SUPPLIES'} onClick={() => setZone('SUPPLIES')} color={ZONE_COLOR.SUPPLIES}>{t('inv.storageZone.supplies')}</Chip>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center' }}>
        <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-muted-fg)', marginRight: 'var(--space-1)' }}>{t('inv.filter.category')}:</span>
        <Chip active={cat === 'ALL'} onClick={() => setCat('ALL')}>{t('inv.filter.all')}</Chip>
        {(Object.keys(CATEGORY_LABEL) as MaterialCategory[])
          .filter(c => (catCounts.get(c) ?? 0) > 0)
          .map(c => (
            <Chip key={c} active={cat === c} onClick={() => setCat(c)}>
              {CATEGORY_LABEL[c].en} ({catCounts.get(c)})
            </Chip>
          ))}
      </div>

      {/* Empty state */}
      {materials.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-7) var(--space-4)' }}>
          <Package size={48} style={{ color: 'var(--color-subtle-fg)', marginBottom: 'var(--space-3)' }} />
          <h3>{t('inv.emptyTitle')}</h3>
          <p style={{ color: 'var(--color-muted-fg)', marginBottom: 'var(--space-4)' }}>
            {t('inv.emptyHint')}
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/inventory/import" className="btn btn-primary">
              <Upload size={16} /> {t('inv.importStockList')}
            </Link>
            <Link href="/inventory/new" className="btn btn-secondary">
              <Plus size={16} /> {t('inv.addManually')}
            </Link>
          </div>
        </div>
      )}

      {/* No filter matches */}
      {materials.length > 0 && filtered.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-5)', color: 'var(--color-muted-fg)' }}>
          {t('inv.noMatches')}
        </div>
      )}

      {/* Table — scroll inside so the page itself stays compact */}
      {filtered.length > 0 && (
        <div className="card table-scroll" style={{ padding: 0 }}>
          <table style={{ minWidth: 760, fontSize: '0.9375rem' }}>
              <thead>
                <tr style={{ background: 'var(--color-surface-alt)' }}>
                  <Th>{t('inv.th.name')}</Th>
                  <Th className="num">{t('inv.th.onHand')}</Th>
                  <Th>{t('inv.th.status')}</Th>
                  <Th>{t('inv.th.category')}</Th>
                  <Th>{t('inv.th.zone')}</Th>
                  <Th className="num">{t('inv.th.parLevel')}</Th>
                  <Th>{t('inv.th.nextExpiry')}</Th>
                  <Th className="num">{t('inv.th.lastCost')}</Th>
                  <Th style={{ width: 60 }}></Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(m => {
                  const s = snap(m.id);
                  const attention = s.status === 'EXPIRED' || s.status === 'OUT' || s.status === 'LOW' || s.status === 'EXPIRING';
                  return (
                  <tr
                    key={m.id}
                    style={{
                      borderTop: '1px solid var(--color-border)',
                      // Subtle tint for rows that need action — keeps the eye where it matters
                      background: attention ? STATUS_STYLE[s.status].bg : 'transparent',
                    }}
                  >
                    <Td>
                      <div style={{ fontWeight: 500 }}>
                        {m.code && <span style={{ color: 'var(--color-subtle-fg)', marginRight: 8, fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}>{m.code}</span>}
                        {m.name}
                      </div>
                      {m.nameLocal && (
                        <div lang="my" style={{ color: 'var(--color-muted-fg)', fontSize: '0.875rem', fontFamily: 'var(--font-myanmar)' }}>
                          {m.nameLocal}
                        </div>
                      )}
                    </Td>
                    <Td className="num tabular-nums">
                      <span style={{ fontWeight: 600 }}>
                        {s.onHand.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                      </span>
                      <span style={{ color: 'var(--color-subtle-fg)', fontSize: '0.75rem', marginLeft: 4 }}>
                        {m.baseUnit}
                      </span>
                    </Td>
                    <Td>
                      <StatusBadge status={s.status} label={t(STATUS_STYLE[s.status].dictKey)} />
                    </Td>
                    <Td>
                      <span className="pill" style={{ background: 'var(--color-surface-alt)', color: 'var(--color-muted-fg)' }}>
                        {CATEGORY_LABEL[m.category].en}
                      </span>
                    </Td>
                    <Td>
                      <span className="pill" style={{ background: 'transparent', border: `1px solid ${ZONE_COLOR[m.storageZone]}`, color: ZONE_COLOR[m.storageZone] }}>
                        {ZONE_LABEL[m.storageZone]}
                      </span>
                    </Td>
                    <Td className="num tabular-nums">{m.parLevel ?? '—'}</Td>
                    <Td>
                      <ExpiryCell isoDate={s.nearestExpiry} />
                    </Td>
                    <Td className="num tabular-nums">{m.lastUnitCost != null ? `${m.lastUnitCost.toLocaleString()} ` : '—'}</Td>
                    <Td>
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                        <Link
                          href={`/inventory/${m.id}`}
                          className="btn btn-ghost btn-sm"
                          style={{ minHeight: 32, padding: '4px 10px' }}
                          aria-label={`${t('inv.editBtn')} ${m.name}`}
                          title={t('inv.editBtn')}
                        >
                          <Edit3 size={14} />
                        </Link>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => handleDelete(m.id, m.name)}
                          disabled={deletingId === m.id}
                          style={{ minHeight: 32, padding: '4px 10px', color: 'var(--color-destructive)' }}
                          aria-label={`${t('inv.deleteBtn')} ${m.name}`}
                          title={t('inv.deleteBtn')}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </Td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
        </div>
      )}

      <WasteModal
        open={wasteOpen}
        onClose={() => setWasteOpen(false)}
        onSuccess={() => router.refresh()}
        preselectedMaterialId={wastePreselect}
        materials={materials}
      />
    </div>
  );
}

/**
 * Expiry cell — shows the earliest-expiring batch date for this material.
 * Red if already expired, amber if within 7 days, normal otherwise. Dash
 * when the material has no batches on hand (nothing to expire yet). The
 * user fills the actual date when receiving stock (ReceiveStockForm),
 * where each batch carries its own expiry — this column surfaces the
 * earliest one so owners can see risk at a glance in the list view.
 */
function ExpiryCell({ isoDate }: { isoDate: string | null }) {
  if (!isoDate) return <span style={{ color: 'var(--color-subtle-fg)' }}>—</span>;

  const date = new Date(isoDate);
  const now = new Date();
  const msInDay = 24 * 60 * 60 * 1000;
  const daysLeft = Math.floor((date.getTime() - now.getTime()) / msInDay);

  let color: string;
  let weight = 500;
  if (daysLeft < 0) {
    color = 'var(--color-destructive)';
    weight = 600;
  } else if (daysLeft <= 7) {
    color = 'var(--color-warning)';
    weight = 600;
  } else {
    color = 'var(--color-foreground)';
  }

  return (
    <span style={{ color, fontWeight: weight, fontVariantNumeric: 'tabular-nums', fontSize: '0.875rem' }}>
      {isoDate.slice(0, 10)}
    </span>
  );
}

function StatusBadge({ status, label }: { status: StockStatus; label: string }) {
  const s = STATUS_STYLE[status];
  const needsAttention = status === 'EXPIRED' || status === 'OUT' || status === 'LOW' || status === 'EXPIRING';
  return (
    <span
      className="pill"
      style={{
        background: s.bg,
        color: s.fg,
        border: `1px solid ${s.border}`,
        fontWeight: 600,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
      }}
    >
      {needsAttention
        ? <AlertTriangle size={12} aria-hidden="true" />
        : <CircleDot size={12} aria-hidden="true" />}
      {label}
    </span>
  );
}

function Chip({
  active, onClick, color, children,
}: {
  active: boolean;
  onClick: () => void;
  color?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="pill"
      style={{
        background: active ? 'var(--color-primary)' : 'var(--color-surface)',
        color: active ? '#fff' : (color ?? 'var(--color-foreground)'),
        border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border-strong)'}`,
        cursor: 'pointer',
        padding: '6px 12px',
        fontWeight: active ? 600 : 500,
        minHeight: 32,
        fontSize: '0.8125rem',
        fontFamily: 'inherit',
      }}
    >
      {children}
    </button>
  );
}

function Th({ children, className = '', ...rest }: { children?: React.ReactNode; className?: string; style?: React.CSSProperties }) {
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
        ...rest.style,
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, className = '', ...rest }: { children?: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <td
      className={className}
      style={{
        textAlign: className.includes('num') ? 'right' : 'left',
        padding: 'var(--space-3) var(--space-4)',
        color: 'var(--color-foreground)',
        ...rest.style,
      }}
    >
      {children}
    </td>
  );
}
