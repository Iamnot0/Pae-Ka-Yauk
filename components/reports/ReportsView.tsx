'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Download, FileText, TrendingUp, Package, AlertTriangle, Clock, ChevronDown, Receipt, Truck, CreditCard, Layers, ChefHat, ShoppingCart, ShieldAlert, Gift, Tag } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import { useT } from '@/lib/i18n/useT';
import type { DictKey } from '@/lib/i18n/dict';
import { MMK } from '@/components/i18n/MMK';
import { formatDateTime, formatShortDay, formatPeriodRange } from '@/lib/format/datetime';
import { toDisplayCategory, displayCategoryDictKey, type DisplayCategory } from '@/lib/categories';
import type { ItemCategory } from '@/lib/repos/items';
import { generateStockLedgerPdf } from '@/lib/pdf/generateStockLedgerPdf';
import { generateMaterialsPdf } from '@/lib/pdf/generateMaterialsPdf';
import { VoidSaleModal } from './VoidSaleModal';
import { useRouter } from 'next/navigation';
import type {
  ReportPeriod,
  TransactionsReport,
  StockActivityReport,
  InventorySnapshot,
} from '@/lib/repos/reports';

type ReportTab = 'ledger' | 'materials';

interface Props {
  period: ReportPeriod;
  transactions: TransactionsReport;
  stockActivity: StockActivityReport;
  inventory: InventorySnapshot;
  shopName: string;
  logoUrl: string | null;
  /** Drives whether per-sale "Void" buttons are visible. */
  userRole: string;
}

const VOID_ROLES = new Set(['OWNER', 'MANAGER']);

const PERIODS: ReportPeriod[] = ['daily', 'weekly', 'monthly'];

function periodDictKey(p: ReportPeriod): DictKey {
  return p === 'daily' ? 'rpt.period.daily'
       : p === 'weekly' ? 'rpt.period.weekly'
       : 'rpt.period.monthly';
}

export function ReportsView({ period, transactions, stockActivity, inventory, shopName, logoUrl, userRole }: Props) {
  const t = useT();
  const router = useRouter();
  const canVoid = VOID_ROLES.has(userRole);
  const [voidTarget, setVoidTarget] = useState<{ id: string; receiptNumber: string; total: number } | null>(null);
  const [generating, setGenerating] = useState<null | 'ledger' | 'materials'>(null);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ReportTab>('ledger');
  const downloadWrapRef = useRef<HTMLDivElement | null>(null);

  // Date-range label for PDFs — closing reports get filed; "Today" / "Last 7
  // days" rots within a week. The on-screen tabs still use the relative
  // labels for chip text; only the PDF uses this absolute range.
  const periodLabelForPdf = formatPeriodRange(period);

  // Click-outside to close the download menu.
  useEffect(() => {
    if (!downloadOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (downloadWrapRef.current && !downloadWrapRef.current.contains(e.target as Node)) setDownloadOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [downloadOpen]);

  const onDownloadLedger = async () => {
    setDownloadOpen(false);
    setGenerating('ledger');
    try {
      await generateStockLedgerPdf({
        shopName,
        logoUrl,
        period,
        periodLabel: periodLabelForPdf,
        transactions,
        stockActivity,
      });
    } finally {
      setGenerating(null);
    }
  };

  const onDownloadMaterials = async () => {
    setDownloadOpen(false);
    setGenerating('materials');
    try {
      await generateMaterialsPdf({
        shopName,
        logoUrl,
        periodLabel: periodLabelForPdf,
        inventory,
      });
    } finally {
      setGenerating(null);
    }
  };

  const TABS: { key: ReportTab; label: string; icon: LucideIcon }[] = [
    { key: 'ledger',    label: t('rpt.tab.ledger'),    icon: TrendingUp },
    { key: 'materials', label: t('rpt.tab.materials'), icon: Package },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      {/* Header row — title + period chip + download dropdown */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', lineHeight: 1.2, flexShrink: 0 }}>{t('rpt.title')}</h1>

        <div role="tablist" aria-label={t('rpt.title')} style={{ display: 'flex', gap: 2, background: 'var(--color-surface-alt)', padding: 2, borderRadius: 'var(--radius-pill)' }}>
          {PERIODS.map((p) => {
            const active = p === period;
            return (
              <Link
                key={p}
                href={`/reports?period=${p}&tab=${activeTab}` as unknown as never}
                role="tab"
                aria-selected={active}
                style={{
                  padding: '6px 14px',
                  borderRadius: 'var(--radius-pill)',
                  background: active ? 'var(--color-primary)' : 'transparent',
                  color: active ? '#fff' : 'var(--color-foreground)',
                  textDecoration: 'none',
                  fontSize: '0.875rem',
                  fontWeight: active ? 600 : 500,
                  transition: 'background var(--transition-fast), color var(--transition-fast)',
                }}
              >
                {t(periodDictKey(p))}
              </Link>
            );
          })}
        </div>

        <div style={{ flex: 1 }} />

        {/* Download split-dropdown — pick a report */}
        <div ref={downloadWrapRef} style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => setDownloadOpen((v) => !v)}
            disabled={generating !== null}
            aria-haspopup="menu"
            aria-expanded={downloadOpen}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              padding: '8px 14px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-primary)',
              color: '#fff',
              border: 'none',
              fontWeight: 500,
              cursor: generating !== null ? 'progress' : 'pointer',
              opacity: generating !== null ? 0.7 : 1,
            }}
          >
            <Download size={16} strokeWidth={2} />
            {generating === 'ledger'    ? t('rpt.generating')
             : generating === 'materials' ? t('rpt.generating')
             : t('rpt.download')}
            <ChevronDown size={14} strokeWidth={2} style={{ transform: downloadOpen ? 'rotate(180deg)' : 'none', transition: 'transform var(--transition-fast)' }} />
          </button>
          {downloadOpen && (
            <div role="menu" style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              right: 0,
              minWidth: 240,
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-lg)',
              zIndex: 50,
              padding: 4,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}>
              <div style={{ padding: '6px 10px', fontSize: '0.75rem', color: 'var(--color-muted-fg)' }}>
                {t('rpt.download.menu')}
              </div>
              <button type="button" role="menuitem" onClick={onDownloadLedger} style={menuItemStyle}>
                <TrendingUp size={16} strokeWidth={2} style={{ color: 'var(--color-primary)' }} />
                {t('rpt.download.ledger')}
              </button>
              <button type="button" role="menuitem" onClick={onDownloadMaterials} style={menuItemStyle}>
                <Package size={16} strokeWidth={2} style={{ color: 'var(--color-primary)' }} />
                {t('rpt.download.materials')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tab bar — Stock Ledger | Materials */}
      <div role="tablist" aria-label="Report sections" style={{
        display: 'inline-flex',
        gap: 2,
        background: 'var(--color-surface-alt)',
        padding: 4,
        borderRadius: 'var(--radius-md)',
        alignSelf: 'flex-start',
      }}>
        {TABS.map(({ key, label, icon: Icon }) => {
          const active = key === activeTab;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(key)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 16px',
                borderRadius: 'var(--radius-sm)',
                background: active ? 'var(--color-surface)' : 'transparent',
                color: active ? 'var(--color-foreground)' : 'var(--color-muted-fg)',
                border: 'none',
                fontWeight: active ? 600 : 500,
                fontSize: '0.875rem',
                cursor: 'pointer',
                boxShadow: active ? 'var(--shadow-sm)' : 'none',
                transition: 'background var(--transition-fast), color var(--transition-fast)',
              }}
            >
              <Icon size={16} strokeWidth={2} />
              {label}
            </button>
          );
        })}
      </div>

      {/* Transactions / sales / finance now live on the Dashboard. Reports
          stays focused on inventory state — Stock Ledger for finished goods,
          Materials for raw materials. Both share the same shape: KPI row +
          collapsible drill-downs. */}
      {activeTab === 'ledger' ? (
        <StockActivitySection sa={stockActivity} period={period} inv={inventory} />
      ) : (
        <InventorySection inv={inventory} />
      )}

      {/* Manager-only — surfaces a flat list of Recent Sales with a Void
          button on each row. Cashier never sees this block. The list also
          flows from the same `transactions.recentSales` array we pass into
          the PDF, so the PDF + on-screen view stay in lockstep. */}
      {canVoid && transactions.recentSales.length > 0 && (
        <div id="recent-sales" style={{ scrollMarginTop: 'var(--space-4)' }}>
          <RecentSalesAdmin
            rows={transactions.recentSales}
            slipsWithLines={transactions.salesWithLines}
            onVoid={(r) => setVoidTarget({ id: r.id, receiptNumber: r.receiptNumber, total: r.total })}
          />
        </div>
      )}

      <VoidSaleModal
        open={voidTarget !== null}
        onClose={() => setVoidTarget(null)}
        onSuccess={() => router.refresh()}
        sale={voidTarget}
      />
    </div>
  );
}

/**
 * Compact Recent Sales table with a per-row Void button. Hidden from
 * cashiers; only OWNER/MANAGER see it. Voided rows show a struck-through
 * total + a "Voided" tag instead of the button.
 */
function RecentSalesAdmin({
  rows, slipsWithLines, onVoid,
}: {
  rows: TransactionsReport['recentSales'];
  slipsWithLines: TransactionsReport['salesWithLines'];
  onVoid: (r: TransactionsReport['recentSales'][number]) => void;
}) {
  const t = useT();
  // Lookup map for click → modal: matches a clicked row's sale id to its
  // expanded line items. Sales beyond the 50-newest cap don't have line
  // items eagerly loaded; the modal renders a soft "details unavailable"
  // for those — see SlipDetailsModal below.
  const linesById = useMemo(() => {
    const m = new Map<string, TransactionsReport['salesWithLines'][number]>();
    for (const s of slipsWithLines) m.set(s.id, s);
    return m;
  }, [slipsWithLines]);

  const [selected, setSelected] = useState<TransactionsReport['recentSales'][number] | null>(null);

  return (
    <CollapsibleSection id="rpt-recent-sales" icon={Receipt} title={t('rpt.tx.recentSales')}>
      {/* Vertically-scrollable table — keeps the page short on a busy day. */}
      <div style={{
        maxHeight: 420,
        overflowY: 'auto',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
      }}>
        <ReportTable
          head={[t('rpt.col.receipt'), t('rpt.col.time'), t('rpt.col.items'), t('rpt.col.tender'), t('rpt.col.total'), '']}
          rows={rows.map((r) => {
            const isVoided = r.status === 'VOIDED';
            const totalCell = isVoided
              ? <span style={{ textDecoration: 'line-through', color: 'var(--color-muted-fg)' }}><MMK amount={r.total} /></span>
              : <MMK amount={r.total} />;
            const actionCell = isVoided
              ? <span style={{ fontSize: '0.75rem', color: 'var(--color-destructive)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('void.tag')}</span>
              : (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onVoid(r); }}
                  style={{
                    padding: '4px 10px',
                    fontSize: '0.75rem',
                    fontWeight: 500,
                    background: 'transparent',
                    border: '1px solid var(--color-destructive)',
                    color: 'var(--color-destructive)',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                  }}
                >
                  {t('void.btn')}
                </button>
              );
            return [
              r.receiptNumber,
              formatDateTime(r.createdAtIso),
              r.itemCount,
              r.tenderType,
              totalCell,
              actionCell,
            ];
          })}
          alignRight={[2, 4]}
          onRowClick={(i) => setSelected(rows[i])}
        />
      </div>

      {selected && (
        <SlipDetailsModal
          slip={selected}
          lines={linesById.get(selected.id)?.lines ?? null}
          onClose={() => setSelected(null)}
        />
      )}
    </CollapsibleSection>
  );
}

/**
 * Modal shown when the user clicks a row in Recent Sales. Renders the slip
 * header + line items table. Older slips (beyond the 50-newest cap that's
 * eagerly joined with sale_lines) render a soft "details unavailable" hint
 * — those can still be drilled into via the Slip Details PDF section.
 */
function SlipDetailsModal({
  slip, lines, onClose,
}: {
  slip: TransactionsReport['recentSales'][number];
  lines: TransactionsReport['salesWithLines'][number]['lines'] | null;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="modal-overlay"
    >
      <div onClick={(e) => e.stopPropagation()} className="modal-card" style={{ maxWidth: 560 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
          <h3 style={{ margin: 0 }}>{slip.receiptNumber}</h3>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">×</button>
        </div>
        <p style={{ margin: '4px 0 var(--space-3)', fontSize: '0.875rem', color: 'var(--color-muted-fg)' }}>
          {formatDateTime(slip.createdAtIso)} · {slip.tenderType} · {slip.status}
        </p>

        {lines && lines.length > 0 ? (
          <ReportTable
            head={[t('rpt.col.item'), t('rpt.col.qty'), t('rpt.col.unit'), t('rpt.col.total')]}
            rows={lines.map((ln) => [
              ln.name,
              ln.qty,
              <MMK amount={ln.unitPrice} key={`up-${ln.name}`} />,
              <MMK amount={ln.lineTotal} key={`lt-${ln.name}`} />,
            ])}
            alignRight={[1, 2, 3]}
          />
        ) : (
          <p style={{ color: 'var(--color-muted-fg)', fontSize: '0.875rem' }}>
            Line items not loaded — this slip is older than the 50-newest cap. Download the Stock Ledger PDF for full per-slip detail.
          </p>
        )}

        <div style={{
          marginTop: 'var(--space-3)',
          paddingTop: 'var(--space-2)',
          borderTop: '1px solid var(--color-border)',
          display: 'flex', justifyContent: 'space-between',
          fontWeight: 600,
        }}>
          <span>{t('rpt.col.total')}</span>
          <MMK amount={slip.total} />
        </div>
      </div>
    </div>
  );
}

const menuItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 10px',
  border: 'none',
  background: 'transparent',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
  fontSize: '0.875rem',
  textAlign: 'left',
  width: '100%',
  color: 'var(--color-foreground)',
};

// ────────────────────────────────────────────────────────────────────
// Section 1 — Transactions
// ────────────────────────────────────────────────────────────────────
function TransactionsSection({ tx, period }: { tx: TransactionsReport; period: ReportPeriod }) {
  const t = useT();
  const showTrend = period !== 'daily' && tx.dailyRevenue.length > 1;

  return (
    <section className="card-xl" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <SectionHeader icon={FileText} title={t('rpt.section.transactions')} />

      <KpiRow
        tiles={[
          { icon: TrendingUp,    label: t('rpt.tx.revenue'),         value: <MMK amount={tx.summary.revenue} />,          tint: 'success' },
          { icon: Receipt,       label: t('rpt.tx.saleCount'),       value: tx.summary.saleCount,                         tint: 'info' },
          { icon: TrendingUp,    label: t('rpt.tx.avgSale'),         value: <MMK amount={tx.summary.avgSale} />,          tint: 'primary' },
          { icon: ShieldAlert,   label: t('rpt.tx.taxTotal'),        value: <MMK amount={tx.summary.taxTotal} />,         tint: 'warning', sublabel: `${tx.summary.taxSlipCount} slip(s)` },
          { icon: Tag,           label: t('rpt.tx.discountTotal'),   value: <MMK amount={tx.summary.discountTotal} />,    tint: 'warning', sublabel: `${tx.summary.discountedCount} sale(s)` },
          { icon: Truck,         label: t('rpt.tx.deliveryTotal'),   value: <MMK amount={tx.summary.deliveryFeeTotal} />, tint: 'info' },
          { icon: AlertTriangle, label: t('rpt.tx.voidCount'),       value: tx.summary.voidCount,                         tint: 'destructive' },
        ]}
      />

      {(tx.tenderMix.length > 0 || tx.modeMix.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--space-3)' }}>
          <MixCard title={t('rpt.tx.tenderMix')} icon={CreditCard} rows={tx.tenderMix.map((r) => ({
            label: r.tenderType,
            count: r.count,
            total: r.total,
          }))} />
          <MixCard title={t('rpt.tx.modeMix')} icon={Layers} rows={tx.modeMix.map((r) => ({
            label: t(`rpt.tx.mode.${r.modeAtCreation}` as DictKey),
            count: r.count,
            total: r.total,
          }))} />
        </div>
      )}

      {showTrend && (
        <div>
          <h4 style={{ margin: '0 0 var(--space-2)' }}>{t('rpt.tx.dailyRevenue')}</h4>
          <div style={{ width: '100%', height: 180 }}>
            <ResponsiveContainer>
              <BarChart data={tx.dailyRevenue.map((d) => ({ ...d, label: d.day.slice(5) }))} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="label" tick={{ fill: 'var(--color-muted-fg)', fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fill: 'var(--color-muted-fg)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip
                  formatter={(v: number) => `${new Intl.NumberFormat('en-US').format(Math.round(v))} MMK`}
                  contentStyle={{
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--color-foreground)',
                  }}
                />
                <Bar dataKey="revenue" fill="var(--color-primary)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {tx.topItems.length > 0 ? (
        <div>
          <h4 style={{ margin: '0 0 var(--space-2)' }}>{t('rpt.tx.topItems')}</h4>
          <ReportTable
            head={[t('rpt.col.item'), t('rpt.col.qty'), t('rpt.col.value')]}
            rows={tx.topItems.map((r) => [
              r.name,
              new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(r.qty),
              <MMK amount={r.revenue} key={r.itemId} />,
            ])}
            alignRight={[1, 2]}
          />
        </div>
      ) : null}

      {tx.recentSales.length > 0 ? (
        <div>
          <h4 style={{ margin: '0 0 var(--space-2)' }}>{t('rpt.tx.recentSales')} ({tx.recentSales.length})</h4>
          <ReportTable
            head={[t('rpt.col.receipt'), t('rpt.col.time'), t('rpt.col.items'), t('rpt.col.tender'), t('rpt.col.total')]}
            rows={tx.recentSales.slice(0, 30).map((r) => [
              r.receiptNumber,
              formatDateTime(r.createdAtIso),
              r.itemCount,
              r.tenderType,
              <MMK amount={r.total} key={r.id} />,
            ])}
            alignRight={[2, 4]}
          />
          {tx.recentSales.length > 30 && (
            <p style={{ margin: 'var(--space-2) 0 0', color: 'var(--color-muted-fg)', fontSize: '0.8125rem' }}>
              Showing 30 of {tx.recentSales.length}. Full list in the PDF download.
            </p>
          )}
        </div>
      ) : (
        <p style={{ color: 'var(--color-muted-fg)', fontSize: '0.875rem' }}>{t('rpt.tx.noSales')}</p>
      )}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────
// Section 2 — Stock activity (Stock Ledger tab)
// 5 KPI tiles always visible. Two collapsible drill-downs at the bottom:
// "By category" + "Out of stock". The card itself is NOT collapsible per
// owner brief 2026-04-27 — only the two drill-downs are.
// ────────────────────────────────────────────────────────────────────
function StockActivitySection({ sa, period }: { sa: StockActivityReport; period: ReportPeriod; inv: InventorySnapshot }) {
  const t = useT();
  const totalIn = sa.dailyActivity.reduce((s, d) => s + d.inCount, 0);
  const totalOut = sa.dailyActivity.reduce((s, d) => s + d.outCount, 0);
  const showTrend = period !== 'daily' && sa.dailyActivity.length > 1;
  const anyActivity = totalIn + totalOut > 0
    || sa.summary.receivedQty > 0
    || sa.summary.bakedQty > 0
    || sa.summary.soldQty > 0;
  const fmtQty = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(n);

  return (
    <section className="card-xl" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <SectionHeader icon={Package} title={t('rpt.section.stockActivity')} />

      <KpiRow
        tiles={[
          { icon: Truck,        label: t('rpt.stock.received'), value: fmtQty(sa.summary.receivedQty), tint: 'success' },
          { icon: ChefHat,      label: t('rpt.stock.baked'),    value: fmtQty(sa.summary.bakedQty),     tint: 'primary' },
          { icon: ShoppingCart, label: t('rpt.stock.sold'),     value: fmtQty(sa.summary.soldQty),      tint: 'info' },
          { icon: ShieldAlert,  label: t('rpt.stock.damaged'),  value: fmtQty(sa.summary.damagedQty),   tint: 'destructive' },
          { icon: Gift,         label: t('rpt.stock.foc'),      value: fmtQty(sa.summary.focQty),       tint: 'warning' },
        ]}
      />

      {showTrend && anyActivity && (
        <div>
          <h4 style={{ margin: '0 0 var(--space-2)' }}>{t('rpt.stock.dailyActivity')}</h4>
          <div style={{ width: '100%', height: 180 }}>
            <ResponsiveContainer>
              <LineChart data={sa.dailyActivity.map((d) => ({ ...d, label: d.day.slice(5) }))} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="label" tick={{ fill: 'var(--color-muted-fg)', fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fill: 'var(--color-muted-fg)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--color-foreground)',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="inCount"  name={t('rpt.col.in')}  stroke="var(--color-success)" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="outCount" name={t('rpt.col.out')} stroke="var(--color-primary)" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {sa.topMoved.length > 0 ? (
        <div>
          <h4 style={{ margin: '0 0 var(--space-2)' }}>{t('rpt.stock.topMoved')}</h4>
          <ReportTable
            head={[t('rpt.col.item'), t('rpt.stock.received'), t('rpt.stock.baked'), t('rpt.stock.sold'), t('rpt.stock.netQty')]}
            rows={sa.topMoved.map((r) => [
              r.name,
              fmtQty(r.receivedQty),
              fmtQty(r.bakedQty),
              fmtQty(r.soldQty),
              fmtQty(r.netQty),
            ])}
            alignRight={[1, 2, 3, 4]}
          />
        </div>
      ) : (
        <p style={{ color: 'var(--color-muted-fg)', fontSize: '0.875rem' }}>{t('rpt.stock.noMovement')}</p>
      )}

      <p style={{
        margin: 0,
        padding: 'var(--space-2) var(--space-3)',
        background: 'var(--color-info-bg)',
        borderRadius: 'var(--radius-sm)',
        color: 'var(--color-muted-fg)',
        fontSize: '0.75rem',
        lineHeight: 1.5,
      }}>
        {t('rpt.stock.note.batchOnly')}
      </p>

      {/* Finished-goods inventory state — symmetric with Materials section. */}
      {sa.fgByCategory.length > 0 && (
        <DrillDown id="fgByCategory" title={t('rpt.fg.byCategory')} defaultOpen={false}>
          <ReportTable
            head={[t('rpt.col.category'), t('rpt.col.items'), t('rpt.col.onHand')]}
            rows={sa.fgByCategory.map((r) => [
              // r.category is already a display-bucket value here — the
              // reports repo consolidates raw enums via toDisplayCategory().
              t(displayCategoryDictKey(r.category as DisplayCategory)),
              r.itemCount,
              fmtQty(r.onHandQty),
            ])}
            alignRight={[1, 2]}
          />
        </DrillDown>
      )}

      {sa.fgOutOfStock.length > 0 && (
        <DrillDown
          id="fgOutOfStock"
          title={`${t('rpt.fg.outOfStock')} (${sa.fgOutOfStock.length})`}
          defaultOpen={false}
          tint="destructive"
        >
          <ReportTable
            head={[t('rpt.col.item'), t('rpt.col.category')]}
            rows={sa.fgOutOfStock.map((r) => [
              <span key={r.id}>
                <span style={{ fontWeight: 500 }}>{r.name}</span>
                {r.nameLocal && (
                  <span lang="my" style={{ color: 'var(--color-muted-fg)', fontSize: '0.75rem', marginLeft: 6 }}>
                    {r.nameLocal}
                  </span>
                )}
              </span>,
              // fgOutOfStock returns RAW enum (untouched by consolidation)
              // because the row is per-item, not aggregated. Map to display
              // bucket here so cashier sees "Hot Drink" not "Hot Coffee".
              t(displayCategoryDictKey(toDisplayCategory(r.category as ItemCategory))),
            ])}
            alignRight={[]}
          />
        </DrillDown>
      )}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────
// Section 3 — Inventory snapshot (Materials tab)
// 4 KPI tiles always visible. Two collapsible drill-downs: "By category"
// + "Out of raw material". Low-stock + expiring stay as plain visible
// sections (per owner brief 2026-04-27: only 2 collapsibles per tab).
// ────────────────────────────────────────────────────────────────────
function InventorySection({ inv }: { inv: InventorySnapshot }) {
  const t = useT();
  const clean = inv.outOfStock.length + inv.lowStock.length + inv.expiring.length === 0;

  return (
    <section className="card-xl" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <SectionHeader icon={Package} title={t('rpt.section.inventory')} />

      <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--color-muted-fg)' }}>
        {t('rpt.inv.asOf')}: {formatDateTime(inv.asOf)}
      </p>

      <KpiRow
        tiles={[
          { icon: Package,        label: t('rpt.inv.totalMaterials'), value: inv.kpis.totalMaterials, tint: 'info' },
          { icon: TrendingUp,     label: t('rpt.inv.stockValue'),     value: <MMK amount={inv.kpis.stockValueMmk} />, tint: 'success' },
          { icon: AlertTriangle,  label: t('rpt.inv.lowStock'),       value: inv.kpis.lowStockCount, tint: 'warning' },
          { icon: Clock,          label: t('rpt.inv.expiring'),       value: inv.kpis.expiringSoonCount, tint: 'destructive' },
        ]}
      />

      {/* Collapsible 1 — By category */}
      {inv.byCategory.length > 0 && (
        <DrillDown id="invByCategory" title={t('rpt.inv.byCategory')} defaultOpen={false}>
          <ReportTable
            head={[t('rpt.col.category'), t('rpt.col.material'), t('rpt.col.value')]}
            rows={inv.byCategory.map((r) => [
              t(`mat.cat.${r.category}` as DictKey),
              r.materialCount,
              <MMK amount={r.valueMmk} key={r.category} />,
            ])}
            alignRight={[1, 2]}
          />
        </DrillDown>
      )}

      {/* Collapsible 2 — Out of raw material (renamed from "Out of stock"
          to disambiguate from finished-goods on the Stock Ledger tab) */}
      {inv.outOfStock.length > 0 && (
        <DrillDown
          id="invOutOfRawMaterial"
          title={`${t('rpt.inv.outOfRawMaterial')} (${inv.outOfStock.length})`}
          defaultOpen={false}
          tint="destructive"
        >
          <ReportTable
            head={[t('rpt.col.material'), t('rpt.col.unit'), t('rpt.col.par')]}
            rows={inv.outOfStock.slice(0, 30).map((r) => [
              r.name,
              r.unit,
              r.parLevel != null ? new Intl.NumberFormat('en-US').format(r.parLevel) : '—',
            ])}
            alignRight={[2]}
          />
          {inv.outOfStock.length > 30 && (
            <p style={{ margin: 'var(--space-2) 0 0', color: 'var(--color-muted-fg)', fontSize: '0.8125rem' }}>
              Showing 30 of {inv.outOfStock.length}. Full list in the PDF.
            </p>
          )}
        </DrillDown>
      )}

      {clean && (
        <p style={{ color: 'var(--color-success)', fontSize: '0.875rem', fontWeight: 500 }}>
          {t('rpt.inv.allHealthy')}
        </p>
      )}

      {inv.lowStock.length > 0 && (
        <div>
          <h4 style={{ margin: '0 0 var(--space-2)', color: 'var(--color-warning)' }}>
            {t('rpt.inv.lowStock')} ({inv.lowStock.length})
          </h4>
          <ReportTable
            head={[t('rpt.col.material'), t('rpt.col.onHand'), t('rpt.col.par'), t('rpt.col.unit')]}
            rows={inv.lowStock.map((r) => [
              r.name,
              new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(r.onHand),
              new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(r.parLevel),
              r.unit,
            ])}
            alignRight={[1, 2]}
          />
        </div>
      )}

      {inv.expiring.length > 0 && (
        <div>
          <h4 style={{ margin: '0 0 var(--space-2)', color: 'var(--color-info)' }}>
            {t('rpt.inv.expiring')} ({inv.expiring.length})
          </h4>
          <ReportTable
            head={[t('rpt.col.material'), t('rpt.col.qty'), t('rpt.col.unit'), t('rpt.col.expires')]}
            rows={inv.expiring.map((r) => [
              r.name,
              new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(r.remainingQty),
              r.unit,
              r.expiryDate,
            ])}
            alignRight={[1]}
          />
        </div>
      )}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────
// Shared sub-components
// ────────────────────────────────────────────────────────────────────
type Tint = 'success' | 'info' | 'warning' | 'destructive' | 'primary';

function SectionHeader({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
      <Icon size={18} strokeWidth={2} style={{ color: 'var(--color-primary)' }} />
      <h3 style={{ margin: 0 }}>{title}</h3>
    </div>
  );
}

/**
 * Lightweight nested collapsible — used for sub-sections inside an already-
 * carded section (CollapsibleSection wraps in card-xl; this one doesn't, so
 * nesting them stays visually flat). State persists per id in localStorage.
 */
function DrillDown({
  id, title, defaultOpen = true, children, tint,
}: {
  id: string;
  title: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  tint?: 'destructive' | 'warning';
}) {
  const storageKey = `paeKaYauk.reports.drill.${id}.open`;
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    const stored = typeof window === 'undefined' ? null : window.localStorage.getItem(storageKey);
    if (stored === 'false') setOpen(false);
    else if (stored === 'true') setOpen(true);
  }, [storageKey]);
  const toggle = () => {
    setOpen((v) => {
      const next = !v;
      if (typeof window !== 'undefined') window.localStorage.setItem(storageKey, String(next));
      return next;
    });
  };
  const headColor = tint === 'destructive' ? 'var(--color-destructive)'
                  : tint === 'warning'     ? 'var(--color-warning)'
                  : 'var(--color-foreground)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: open ? 'var(--space-2)' : 0 }}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={`drill-${id}`}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 'var(--space-2)',
          padding: 'var(--space-2) var(--space-3)',
          background: 'var(--color-surface-alt)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          textAlign: 'left', cursor: 'pointer', width: '100%',
          color: headColor, fontSize: '0.9375rem', fontWeight: 600,
        }}
      >
        <span>{title}</span>
        <ChevronDown
          size={18} strokeWidth={2}
          style={{
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform var(--transition-fast)',
            flexShrink: 0, color: 'var(--color-muted-fg)',
          }}
        />
      </button>
      {open && (
        <div id={`drill-${id}`}>
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * Collapsible section — click header to toggle. Defaults open. Remembers state
 * per-id in localStorage under `paeKaYauk.reports.{id}.open`.
 */
function CollapsibleSection({
  id,
  icon: Icon,
  title,
  children,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  const storageKey = `paeKaYauk.reports.${id}.open`;
  const [open, setOpen] = useState(true);

  // Hydrate on mount (avoids SSR/client mismatch: initial render is always open)
  useEffect(() => {
    const stored = typeof window === 'undefined' ? null : window.localStorage.getItem(storageKey);
    if (stored === 'false') setOpen(false);
    else if (stored === 'true') setOpen(true);
  }, [storageKey]);

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') window.localStorage.setItem(storageKey, String(next));
      return next;
    });
  };

  return (
    <section className="card-xl" style={{ display: 'flex', flexDirection: 'column', gap: open ? 'var(--space-4)' : 0 }}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={`${id}-body`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          background: 'none',
          border: 'none',
          padding: 0,
          margin: 0,
          cursor: 'pointer',
          width: '100%',
          textAlign: 'left',
          color: 'inherit',
        }}
      >
        <Icon size={18} strokeWidth={2} style={{ color: 'var(--color-primary)' }} />
        <h3 style={{ margin: 0, flex: 1 }}>{title}</h3>
        <ChevronDown
          size={18}
          aria-hidden="true"
          style={{
            color: 'var(--color-muted-fg)',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform var(--transition-fast)',
          }}
        />
      </button>
      {open && (
        <div id={`${id}-body`} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {children}
        </div>
      )}
    </section>
  );
}

function KpiRow({ tiles }: { tiles: Array<{ icon: typeof Download; label: string; value: React.ReactNode; tint: Tint; sublabel?: string }> }) {
  return (
    <div style={{
      display: 'grid',
      // 160px floor so 6 tiles fit on a 1100px content area; auto-fit
      // collapses empty tracks so 4 tiles still take the full row.
      gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
      gap: 'var(--space-3)',
    }}>
      {tiles.map((tile, i) => <KpiTile key={i} {...tile} />)}
    </div>
  );
}

/**
 * Tender / Mode mix card — small horizontal bar list, sums to 100% within
 * the card. Mirrors the TopSelling/TopMaterials look so the eye reads
 * "this is a ranked breakdown" without needing a chart library.
 */
function MixCard({
  title, icon: Icon, rows,
}: {
  title: string;
  icon: LucideIcon;
  rows: Array<{ label: string; count: number; total: number }>;
}) {
  if (rows.length === 0) return null;
  const grand = rows.reduce((s, r) => s + r.total, 0) || 1;
  return (
    <div style={{
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-3)',
      background: 'var(--color-surface)',
      display: 'flex', flexDirection: 'column', gap: 'var(--space-2)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8125rem', fontWeight: 600 }}>
        <Icon size={14} strokeWidth={2} style={{ color: 'var(--color-primary)' }} />
        {title}
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map((r) => {
          const pct = Math.max((r.total / grand) * 100, 4);
          return (
            <li key={r.label}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, fontSize: '0.8125rem', marginBottom: 2 }}>
                <span style={{ fontWeight: 500 }}>{r.label}</span>
                <span className="tabular-nums" style={{ color: 'var(--color-muted-fg)' }}>
                  {r.count} · <MMK amount={r.total} />
                </span>
              </div>
              <div style={{ height: 4, background: 'var(--color-surface-alt)', borderRadius: 'var(--radius-pill)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: 'var(--color-primary)', borderRadius: 'inherit' }} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const TINT_BG: Record<Tint, string> = {
  success:     'var(--color-success-bg)',
  info:        'var(--color-info-bg)',
  warning:     'var(--color-warning-bg)',
  destructive: 'var(--color-destructive-bg)',
  primary:     'var(--color-surface-alt)',
};

const TINT_FG: Record<Tint, string> = {
  success:     'var(--color-success)',
  info:        'var(--color-info)',
  warning:     'var(--color-warning)',
  destructive: 'var(--color-destructive)',
  primary:     'var(--color-primary)',
};

function KpiTile({ icon: Icon, label, value, tint, sublabel }: { icon: typeof Download; label: string; value: React.ReactNode; tint: Tint; sublabel?: string }) {
  // Vertical stack: icon / value / label. Same rhythm as the dashboard
  // KPIs so /reports + / dashboard read as one visual language. The
  // nowrap+ellipsis on value keeps "11,550 MMK" intact even on narrow
  // 5- or 6-tile rows — solves the right-edge truncation Boss flagged.
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      padding: 'var(--space-3) var(--space-4)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-md)',
      background: 'var(--color-surface)',
      minWidth: 0,
    }}>
      <div aria-hidden="true" style={{
        width: 32, height: 32, borderRadius: 'var(--radius-sm)',
        background: TINT_BG[tint], color: TINT_FG[tint],
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <Icon size={18} strokeWidth={2} />
      </div>
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: '1.125rem',
          fontWeight: 700,
          lineHeight: 1.2,
          color: 'var(--color-foreground)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          minWidth: 0,
        }}
      >
        {value}
      </div>
      <div style={{
        fontSize: '0.75rem',
        color: 'var(--color-muted-fg)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>
        {label}
      </div>
      {sublabel && (
        <div style={{
          fontSize: '0.6875rem',
          color: 'var(--color-muted-fg)',
          opacity: 0.75,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {sublabel}
        </div>
      )}
    </div>
  );
}

function ReportTable({
  head, rows, alignRight = [], maxHeight = 320, onRowClick,
}: {
  head: string[];
  rows: Array<Array<React.ReactNode>>;
  alignRight?: number[];
  maxHeight?: number;
  /** Optional click handler — when provided, rows render as interactive
   *  with hover background and pointer cursor. Receives the row index. */
  onRowClick?: (rowIndex: number) => void;
}) {
  const rightSet = new Set(alignRight);
  const clickable = !!onRowClick;
  return (
    <div
      style={{
        overflow: 'auto',
        maxHeight,
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--color-surface)',
      }}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
        <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--color-surface-alt)' }}>
          <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
            {head.map((h, i) => (
              <th key={i} style={{
                padding: 'var(--space-2) var(--space-3)',
                textAlign: rightSet.has(i) ? 'right' : 'left',
                fontWeight: 600,
                color: 'var(--color-muted-fg)',
                fontSize: '0.75rem',
                textTransform: 'uppercase',
                letterSpacing: '0.03em',
              }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr
              key={ri}
              onClick={clickable ? () => onRowClick(ri) : undefined}
              style={{
                borderBottom: '1px solid var(--color-border-subtle, var(--color-border))',
                cursor: clickable ? 'pointer' : undefined,
                transition: clickable ? 'background var(--transition-fast)' : undefined,
              }}
              onMouseEnter={clickable ? (e) => { e.currentTarget.style.background = 'var(--color-surface-alt)'; } : undefined}
              onMouseLeave={clickable ? (e) => { e.currentTarget.style.background = 'transparent'; } : undefined}
            >
              {row.map((cell, ci) => (
                <td key={ci} style={{
                  padding: 'var(--space-2) var(--space-3)',
                  textAlign: rightSet.has(ci) ? 'right' : 'left',
                  fontVariantNumeric: rightSet.has(ci) ? 'tabular-nums' : undefined,
                }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
