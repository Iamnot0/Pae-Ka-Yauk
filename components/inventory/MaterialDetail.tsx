'use client';

import Link from 'next/link';
import { Pencil, Layers, Activity } from 'lucide-react';
import { useT } from '@/lib/i18n/useT';
import { MMK } from '@/components/i18n/MMK';
import { MaterialForm } from '@/components/inventory/MaterialForm';
import type { RawMaterial } from '@/lib/repos/materials';
import type { StockBatch, StockMovement, MovementReason } from '@/lib/stock/ledger';
import type { DictKey } from '@/lib/i18n/dict';

type Tab = 'edit' | 'batches' | 'movements';

interface Props {
  material: RawMaterial;
  onHand: number;
  tab: Tab;
  batches: StockBatch[];
  movements: StockMovement[];
}

export function MaterialDetail({ material, onHand, tab, batches, movements }: Props) {
  const t = useT();

  return (
    <>
      <header>
        <h1 style={{ marginBottom: 4 }}>{material.name}</h1>
        {material.nameLocal && (
          <p lang="my" className="text-myanmar" style={{ color: 'var(--color-muted-fg)', margin: 0 }}>
            {material.nameLocal}
          </p>
        )}
        <p style={{ color: 'var(--color-muted-fg)', margin: '8px 0 0', fontSize: '0.9375rem' }}>
          <strong style={{ color: 'var(--color-primary)' }}>{onHand.toLocaleString(undefined, { maximumFractionDigits: 4 })} {material.baseUnit}</strong>
          {' · '}
          {material.category.replace(/_/g, ' ').toLowerCase()}
          {' · '}
          {material.storageZone}
          {material.parLevel != null && ` · par ${material.parLevel}`}
        </p>
      </header>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--color-border)' }}>
        <TabLink id={material.id} active={tab === 'edit'}      tab="edit"      icon={<Pencil size={14} />}   label={t('mat.tab.edit')} />
        <TabLink id={material.id} active={tab === 'batches'}   tab="batches"   icon={<Layers size={14} />}   label={t('mat.tab.batches')} />
        <TabLink id={material.id} active={tab === 'movements'} tab="movements" icon={<Activity size={14} />} label={t('mat.tab.movements')} />
      </div>

      {tab === 'edit' && <MaterialForm mode="edit" initial={material} />}
      {tab === 'batches' && <BatchesTable batches={batches} baseUnit={material.baseUnit} t={t} />}
      {tab === 'movements' && <MovementsTable movements={movements} t={t} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TabLink({ id, active, tab, icon, label }: {
  id: string; active: boolean; tab: Tab; icon: React.ReactNode; label: string;
}) {
  const href = tab === 'edit' ? `/inventory/${id}` : `/inventory/${id}?tab=${tab}`;
  return (
    <Link
      // Next.js 16 experimental typed-routes: dynamic [id] requires loose typing
      href={href as unknown as never}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '10px 16px',
        color: active ? 'var(--color-primary)' : 'var(--color-muted-fg)',
        fontWeight: active ? 600 : 500,
        borderBottom: `2px solid ${active ? 'var(--color-primary)' : 'transparent'}`,
        marginBottom: -1,
        textDecoration: 'none',
        fontSize: '0.9375rem',
      }}
    >
      {icon} {label}
    </Link>
  );
}

function BatchesTable({ batches, baseUnit, t }: {
  batches: StockBatch[];
  baseUnit: string;
  t: ReturnType<typeof useT>;
}) {
  if (batches.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 'var(--space-6)', color: 'var(--color-muted-fg)' }}>
        {t('mat.batches.empty')}
      </div>
    );
  }
  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString() : '—';

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
          <thead>
            <tr style={{ background: 'var(--color-surface-alt)' }}>
              <Th>{t('mat.batches.th.received')}</Th>
              <Th className="num">{t('mat.batches.th.qty')}</Th>
              <Th className="num">{t('mat.batches.th.remaining')}</Th>
              <Th className="num">{t('mat.batches.th.cost')}</Th>
              <Th>{t('mat.batches.th.expiry')}</Th>
              <Th>{t('mat.batches.th.invoice')}</Th>
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => {
              const remainingPct = b.receivedQty > 0 ? (b.remainingQty / b.receivedQty) * 100 : 0;
              const expiringSoon = b.expiryDate && new Date(b.expiryDate).getTime() - Date.now() < 7 * 86400_000;
              const expired = b.expiryDate && new Date(b.expiryDate) <= new Date();
              return (
                <tr key={b.id} style={{
                  borderTop: '1px solid var(--color-border)',
                  background: expired ? 'rgba(139, 38, 53, 0.08)' : expiringSoon ? 'rgba(204, 107, 34, 0.08)' : 'transparent',
                }}>
                  <Td>{fmtDate(b.receivedAt)}</Td>
                  <Td className="num tabular-nums">
                    {b.receivedQty.toLocaleString(undefined, { maximumFractionDigits: 4 })} {baseUnit}
                  </Td>
                  <Td className="num tabular-nums">
                    <div style={{ fontWeight: 600 }}>
                      {b.remainingQty.toLocaleString(undefined, { maximumFractionDigits: 4 })} {baseUnit}
                    </div>
                    <div style={{
                      height: 3, width: 60, background: 'var(--color-surface-alt)',
                      borderRadius: 2, marginTop: 3, marginLeft: 'auto', overflow: 'hidden',
                    }}>
                      <div style={{
                        height: '100%',
                        width: `${remainingPct}%`,
                        background: remainingPct < 25 ? 'var(--color-destructive)' : 'var(--color-accent)',
                      }} />
                    </div>
                  </Td>
                  <Td className="num tabular-nums">
                    <MMK amount={b.unitCost} /> / {baseUnit}
                  </Td>
                  <Td>{fmtDate(b.expiryDate)}</Td>
                  <Td style={{ fontSize: '0.8125rem', color: 'var(--color-muted-fg)' }}>
                    {b.invoiceRef ?? '—'}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MovementsTable({ movements, t }: {
  movements: StockMovement[];
  t: ReturnType<typeof useT>;
}) {
  if (movements.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 'var(--space-6)', color: 'var(--color-muted-fg)' }}>
        {t('mat.mov.empty')}
      </div>
    );
  }
  const fmtTime = (iso: string) => new Date(iso).toLocaleString();
  const reasonKey = (r: MovementReason) => `mat.mov.reason.${r}` as DictKey;

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 780 }}>
          <thead>
            <tr style={{ background: 'var(--color-surface-alt)' }}>
              <Th>{t('mat.mov.th.when')}</Th>
              <Th>{t('mat.mov.th.kind')}</Th>
              <Th>{t('mat.mov.th.reason')}</Th>
              <Th className="num">{t('mat.mov.th.qty')}</Th>
              <Th>{t('mat.mov.th.ref')}</Th>
            </tr>
          </thead>
          <tbody>
            {movements.map((m) => {
              const signed = Number(m.qty);
              const isIn = m.kind === 'IN';
              return (
                <tr key={m.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                  <Td style={{ fontSize: '0.8125rem', color: 'var(--color-muted-fg)' }}>
                    {fmtTime(m.createdAt)}
                  </Td>
                  <Td>
                    <span className="pill" style={{
                      background: isIn ? 'rgba(90, 166, 90, 0.1)' : 'rgba(139, 38, 53, 0.08)',
                      color: isIn ? 'var(--color-success)' : 'var(--color-destructive)',
                      border: `1px solid ${isIn ? 'var(--color-success)' : 'var(--color-destructive)'}`,
                      fontSize: '0.75rem',
                    }}>
                      {m.kind}
                    </span>
                  </Td>
                  <Td style={{ fontSize: '0.9375rem' }}>
                    {t(reasonKey(m.reason))}
                    {m.note && (
                      <div style={{ color: 'var(--color-muted-fg)', fontSize: '0.8125rem' }}>
                        {m.note}
                      </div>
                    )}
                  </Td>
                  <Td className="num tabular-nums" style={{
                    color: signed > 0 ? 'var(--color-success)' : 'var(--color-destructive)',
                    fontWeight: 600,
                  }}>
                    {signed > 0 ? '+' : ''}
                    {signed.toLocaleString(undefined, { maximumFractionDigits: 4 })} {m.unit}
                  </Td>
                  <Td style={{ fontSize: '0.75rem', color: 'var(--color-subtle-fg)' }}>
                    {m.saleId && <span title={m.saleId}>sale {m.saleId.slice(-6)}</span>}
                    {m.wasteId && <span title={m.wasteId}>waste {m.wasteId.slice(-6)}</span>}
                    {m.batchId && (
                      <div style={{ color: 'var(--color-subtle-fg)' }}>batch {m.batchId.slice(0, 8)}…</div>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
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
