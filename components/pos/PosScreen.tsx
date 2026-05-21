'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, Minus, Trash2, X, Receipt, Banknote, Printer, Lock, Truck, Percent, Tag } from 'lucide-react';
import type { ItemCategory } from '@/lib/repos/items';
import type { DictKey } from '@/lib/i18n/dict';

// Operational POS quick-filter groups. NOT 1:1 with the ItemCategory enum:
// "Hot" covers BOTH Hot Coffee + Tea, "Cold" covers Cold Coffee + Cold Drink,
// "Dessert" is a parent that swallows Cake + Bread + Pastry + Cookies as
// well as DESSERT itself. Click "Cake" → only cakes. `null` = show everything.
type PosCatKey = 'ALL' | 'HOT' | 'COLD' | 'DESSERT' | 'CAKE' | 'COOKIES' | 'BREAD';

const POS_CAT_GROUPS: Record<PosCatKey, ReadonlyArray<ItemCategory> | null> = {
  ALL:     null,
  HOT:     ['COFFEE_HOT', 'TEA'],
  COLD:    ['COFFEE_COLD', 'COLD_DRINK'],
  DESSERT: ['DESSERT', 'BAKERY_CAKE', 'BAKERY_BREAD', 'BAKERY_PASTRY', 'BAKERY_COOKIES'],
  CAKE:    ['BAKERY_CAKE'],
  COOKIES: ['BAKERY_COOKIES'],
  BREAD:   ['BAKERY_BREAD'],
};

const POS_CAT_DICT: Record<PosCatKey, DictKey> = {
  ALL:     'pos.cat.all',
  HOT:     'pos.cat.hot',
  COLD:    'pos.cat.cold',
  DESSERT: 'pos.cat.dessert',
  CAKE:    'pos.cat.cake',
  COOKIES: 'pos.cat.cookies',
  BREAD:   'pos.cat.bread',
};

const POS_CAT_ORDER: PosCatKey[] = ['ALL', 'HOT', 'COLD', 'CAKE', 'COOKIES', 'BREAD', 'DESSERT'];
import { ReceiptBarcode } from './ReceiptBarcode';
import { useT } from '@/lib/i18n/useT';
import { trBoth } from '@/lib/i18n/dict';
import { MMK } from '@/components/i18n/MMK';
import { renderReceiptCanvas } from '@/lib/printing/renderReceiptCanvas';
import { applyTaxIf, computeDiscount } from '@/lib/config/tax';
import { newId } from '@/lib/client/ulid';
import { enqueueWrite, onOpDone } from '@/lib/client/outbox';
// Scanner is mounted globally in app/(app)/layout.tsx → on scan, the user
// is pushed to /pos?scan=<code>. PosScreen reads that query param below
// and dispatches the same addItem flow. No local key listener needed.
import type { CatalogItem } from '@/lib/repos/catalog';

/**
 * POS only needs the slim cashier-facing fields (id, name, price, taxRate,
 * imageUrl, productionMode, category) — not the full CatalogItem. The
 * prop type matches what IDB hands us via `getCatalogLocal()` so PosShell
 * can pass the catalog directly with no adapter.
 */
interface Props {
  items: CatalogItem[];
}

// UI offers Cash only (owner pref 2026-05-21 — KBZ Pay / MOBILE_MONEY
// removed entirely along with historical KBZ sale_transactions). The server
// still validates against the remaining TenderType values for any future
// re-introduction of CARD/BANK_TRANSFER/SPLIT/CREDIT.
type Tender = 'CASH';

interface CartLine {
  itemId: string;
  name: string;
  unitPrice: number;
  taxRate: number;
  qty: number;
}

interface SaleResponse {
  sale: {
    id: string;
    /** null on offline-pending sales — server assigns when the outbox drains. */
    receiptNumber: string | null;
    createdAt: string;
    /** Optional — populated by the local-synthesis path; server omits. */
    cashierId?: string;
    modeAtCreation?: 'POS_PAUSED' | 'FULL';
    subtotal: number;
    /** Whether the cashier opted-in to 5% tax for this sale. */
    taxApplied: boolean;
    taxTotal: number;
    /** Discount rate (0-100) the cashier typed, or 0 if no discount. */
    discountPct: number;
    discountTotal: number;
    deliveryFee: number;
    total: number;
    tenderType: string;
    amountTendered: number;
    changeGiven: number;
    lines: Array<{
      id: string;
      itemId?: string;       // present in local synthesis
      itemName: string;
      qty: number;
      unitPrice: number;
      taxRate?: number;      // present in local synthesis
      lineTotal: number;
      lineTax: number;
    }>;
  };
  deductions?: Array<{ materialId: string; qty: number; unit: string }>;
  /** True when this is the canonical persisted state from a duplicate POST (server idempotency contract). */
  idempotent?: boolean;
}

export function PosScreen({ items }: Props) {
  const t = useT();
  const router = useRouter();

  const [cart, setCart] = useState<CartLine[]>([]);
  // Tender is locked to CASH (KBZ removed 2026-05-21). Kept as a typed const
  // so payload shape stays explicit; if future tender methods return, this
  // becomes a useState again.
  const tender: Tender = 'CASH';
  const [cashTendered, setCashTendered] = useState('');
  const [deliveryFee, setDeliveryFee] = useState('');
  // Tax opt-in per sale (owner pref 2026-05-21). Default false = no tax line
  // on the slip. Cashier toggles via the Tax button when a customer asks for
  // a tax receipt. Resets to false after each successful Pay (see clearCart).
  const [taxApplied, setTaxApplied] = useState(false);
  // Discount opt-in per sale (owner spec 2026-05-21): cashier types a
  // percentage each click, applied to the whole bill BEFORE tax. The Dis
  // chip toggles the input row open; the cashier then types the rate
  // (0-100). Empty/zero rate = no discount even when toggled on.
  const [discountApplied, setDiscountApplied] = useState(false);
  const [discountPct, setDiscountPct] = useState('');
  const [posCat, setPosCat] = useState<PosCatKey>('ALL');

  // Filter the items grid by the active quick-filter chip. ALL bypasses
  // filtering entirely; other groups expand to a Set of ItemCategory values.
  const visibleItems = useMemo(() => {
    const allowed = POS_CAT_GROUPS[posCat];
    if (!allowed) return items;
    const set = new Set<ItemCategory>(allowed);
    return items.filter((it) => set.has(it.category as ItemCategory));
  }, [items, posCat]);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<SaleResponse | null>(null);
  // Frozen cart snapshot captured at pay time. The live `cart` is cleared on
  // success, but ReceiptView still needs item-level detail (incl. nameLocal
  // via `items`) to render the bilingual thermal slip.
  const [receiptCart, setReceiptCart] = useState<CartLine[]>([]);

  const subtotal = useMemo(() => cart.reduce((s, l) => s + l.unitPrice * l.qty, 0), [cart]);
  // Discount before tax (owner spec 2026-05-21). Empty pct OR Dis toggled
  // off = 0 discount. Clamped server-side too; here we just don't propagate
  // values outside [0, 100] into the math.
  const discountPctNum = discountApplied
    ? Math.max(0, Math.min(100, Number(discountPct) || 0))
    : 0;
  const discountTotal = useMemo(
    () => computeDiscount(subtotal, discountPctNum),
    [subtotal, discountPctNum]
  );
  // Tax computed on the DISCOUNTED subtotal — owner pref 2026-05-21.
  // Same math in /api/sales (server is authoritative).
  const taxableBase = subtotal - discountTotal;
  const taxTotal = useMemo(() => applyTaxIf(taxApplied, taxableBase), [taxApplied, taxableBase]);
  // Delivery fee — added AFTER tax (service charge, not VAT-able). Matches
  // the same math in /api/sales so client + server agree.
  const deliveryNum = Math.max(0, Math.floor(Number(deliveryFee) || 0));
  const total = taxableBase + taxTotal + deliveryNum;
  const cashNum = Number(cashTendered) || 0;
  const change = tender === 'CASH' ? Math.max(0, cashNum - total) : 0;
  const shortBy = tender === 'CASH' && cashNum < total ? total - cashNum : 0;

  const addItem = (item: CatalogItem) => {
    setCart((prev) => {
      const found = prev.find((l) => l.itemId === item.id);
      if (found) {
        return prev.map((l) => l.itemId === item.id ? { ...l, qty: l.qty + 1 } : l);
      }
      return [...prev, {
        itemId: item.id,
        name: item.name,
        unitPrice: item.price,
        taxRate: item.taxRate ?? 0,
        qty: 1,
      }];
    });
  };

  // ── Sale-response subscription ──────────────────────────────────
  // The synthetic receipt we render after Pay has receiptNumber = null
  // because the daily-reset PKY00042 lives server-side. Once the outbox
  // drains the sale, the server response carries the real receiptNumber.
  // We listen on outbox.onOpDone, match by sale id, and patch the slip
  // in place — the barcode + visible receipt-id swap from "—" / ULID
  // over to "PKY00042" the moment the network confirms the sale.
  useEffect(() => {
    const unsub = onOpDone((id, response) => {
      const r = response as { sale?: { id?: string; receiptNumber?: string | null } } | null;
      const real = r?.sale?.receiptNumber;
      if (!real) return;
      setReceipt((cur) => {
        if (!cur || cur.sale.id !== id) return cur;
        return { ...cur, sale: { ...cur.sale, receiptNumber: real } };
      });
    });
    return unsub;
  }, []);

  // ── Barcode scanner via URL param ───────────────────────────────
  // GlobalScanner (mounted in (app)/layout.tsx) listens app-wide and
  // pushes /pos?scan=<code> on every successful scan. We react to that
  // param here: look up the SKU in the local catalog, add to cart on
  // match, flash a banner either way, then strip the param so a refresh
  // doesn't re-add. This single code path serves both "scan on POS" and
  // "scan from another page → land on POS with item added" — the URL
  // contract is the seam.
  const [scanFlash, setScanFlash] = useState<{ kind: 'ok' | 'miss'; text: string } | null>(null);
  const searchParams = useSearchParams();
  // Two entry points land here:
  //   ?scan=<SKU>     — physical barcode scanner (8-digit numeric)
  //   ?addId=<itemId> — header search picks the item directly by id
  // First found wins. Both clear the param after firing.
  const scanCode = searchParams.get('scan');
  const addId = searchParams.get('addId');
  // De-dupe guard: React 18 strict-mode in dev re-runs effects after the
  // simulated unmount/remount, which would double-add the very first scan
  // (params are still in the URL on the second pass because `router.replace`
  // hadn't landed). Track the last processed key; reset when params clear.
  const lastProcessedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!scanCode && !addId) {
      lastProcessedKeyRef.current = null;
      return;
    }
    const key = scanCode ? `s:${scanCode}` : `a:${addId}`;
    if (lastProcessedKeyRef.current === key) return;
    lastProcessedKeyRef.current = key;

    let match: CatalogItem | undefined;
    let label: string;
    if (scanCode) {
      match = items.find((it) => (it.sku ?? '').toString() === scanCode);
      label = scanCode;
    } else {
      match = items.find((it) => it.id === addId);
      label = match?.sku ?? addId ?? '';
    }

    if (match) {
      addItem(match);
      setScanFlash({ kind: 'ok', text: `${match.name}${label ? ` (${label})` : ''}` });
    } else {
      setScanFlash({ kind: 'miss', text: label });
    }
    // Strip query params — replace, not push, so the back button doesn't
    // bounce the cashier through every prior scan/search.
    router.replace('/pos');
    const t = window.setTimeout(() => setScanFlash(null), 1500);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanCode, addId]);

  const changeQty = (itemId: string, delta: number) => {
    setCart((prev) =>
      prev.flatMap((l) => {
        if (l.itemId !== itemId) return [l];
        const next = l.qty + delta;
        return next <= 0 ? [] : [{ ...l, qty: next }];
      })
    );
  };

  const removeLine = (itemId: string) =>
    setCart((prev) => prev.filter((l) => l.itemId !== itemId));

  const clearCart = () => {
    setCart([]); setCashTendered(''); setDeliveryFee('');
    setTaxApplied(false); setDiscountApplied(false); setDiscountPct('');
    setError('');
  };

  const pay = async () => {
    if (cart.length === 0) { setError('Cart is empty'); return; }
    if (tender === 'CASH' && cashNum < total) {
      setError(`Short by ${(total - cashNum).toLocaleString()} MMK`); return;
    }
    setPaying(true); setError('');
    try {
      // Phase 2 contract (Hard Rule #16): cashier never POSTs /api/sales
      // directly. Mint ULIDs, build payload, ENQUEUE to IndexedDB outbox.
      // The drain loop pushes to the server in the background. Slip prints
      // immediately from the local payload — works whether wifi is up or
      // not. Idempotency on the server (Hard Rule #15) keeps retries safe.
      const saleId = newId();
      const lines = cart.map((l) => ({ id: newId(), itemId: l.itemId, qty: l.qty, modifierDeltas: 0 }));
      const payload = {
        deviceId: 'WEB-01',
        tenderType: tender,
        amountTendered: cashNum,
        deliveryFee: deliveryNum,
        taxApplied,
        discountPct: discountPctNum,
        lines,
      };

      // Synthesise the receipt UI from local data — server prices already
      // came from the catalog; tax + total computed locally with the same
      // 5% policy server uses. The eventual server response is canonical
      // but we don't block on it.
      const localReceipt: SaleResponse = {
        sale: {
          id: saleId,
          receiptNumber: null, // server assigns; UI shows "—" until drain succeeds
          createdAt: new Date().toISOString(),
          cashierId: '',
          modeAtCreation: 'POS_PAUSED',
          subtotal,
          taxApplied,
          taxTotal,
          discountPct: discountPctNum,
          discountTotal,
          deliveryFee: deliveryNum,
          total,
          tenderType: tender,
          amountTendered: cashNum,
          changeGiven: Math.max(0, cashNum - total),
          lines: cart.map((l, i) => ({
            id: lines[i].id,
            itemId: l.itemId,
            itemName: l.name,
            qty: l.qty,
            unitPrice: l.unitPrice,
            taxRate: taxApplied ? 0.05 : 0,
            lineTotal: l.unitPrice * l.qty,
            // Per-line tax kept on the gross line subtotal (no proration
            // of the cart-level discount). Sum may differ from taxTotal
            // by ≤1 MMK when discount is applied; cart-level taxTotal is
            // the authoritative value for slip + reports.
            lineTax: applyTaxIf(taxApplied, l.unitPrice * l.qty),
          })),
        },
        deductions: [],
        idempotent: false,
      };

      await enqueueWrite('/api/sales', payload, { id: saleId });
      setReceiptCart(cart); // snapshot BEFORE clearing
      setReceipt(localReceipt);
      setCart([]); setCashTendered(''); setDeliveryFee('');
      setTaxApplied(false); setDiscountApplied(false); setDiscountPct('');
      router.refresh();
    } catch (e) {
      setError((e as Error).message || 'Sale enqueue failed');
    } finally {
      setPaying(false);
    }
  };

  // Receipt modal — shown after successful sale
  if (receipt) {
    return (
      <ReceiptView
        receipt={receipt}
        cart={receiptCart}
        items={items}
        onClose={() => setReceipt(null)}
        t={t}
      />
    );
  }

  return (
    <div style={{
      display: 'grid',
      // Desktop: 50/50 split (cart breathes — was 1.6 : 1, leaving lots of
      // dead space on the right). Cart has a 440px min so totals + payment
      // chips never wrap. Mobile (≤899px) override in globals.css → stack
      // vertically so the cart pins to the bottom when the bakery owner is
      // on a phone or 7"/8" tablet.
      gridTemplateColumns: 'minmax(0, 1fr) minmax(440px, 1fr)',
      gap: 'var(--space-4)',
      height: 'calc(100vh - 160px)',
      minHeight: 480,
      position: 'relative',
    }} className="pos-grid">
      {/* Scan flash — toast that fades in, holds, then fades out via the
          `scanFlash` CSS keyframe (globals.css). The component still
          unmounts at 1500ms via the setTimeout in the scan effect; the
          animation just paints the entry + exit so it feels smooth
          instead of popping on/off. `key` on the wrapper forces a
          fresh animation on consecutive scans. */}
      {scanFlash && (
        <div
          key={scanFlash.text}
          role="status"
          style={{
            position: 'absolute', top: 8, left: '50%',
            padding: '8px 16px',
            background: scanFlash.kind === 'ok' ? 'var(--color-success)' : 'var(--color-warning)',
            color: '#fff',
            borderRadius: 'var(--radius-pill)',
            fontSize: '0.875rem',
            fontWeight: 500,
            boxShadow: 'var(--shadow-md)',
            zIndex: 10,
            animation: 'scanFlash 1500ms ease forwards',
            pointerEvents: 'none',
          }}
        >
          {scanFlash.kind === 'ok'
            ? `✓ ${scanFlash.text}`
            : `✗ ${t('pos.scan.notFound')} — ${scanFlash.text}`}
        </div>
      )}

      {/* ===== LEFT: Item grid ===== */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', overflowY: 'auto' }}>
        <h1 style={{ margin: 0 }}>{t('nav.pos')}</h1>

        {/* Quick-filter chip row — operational groups, hierarchy notes:
            Dessert ⊃ Cake + Bread + Pastry, so clicking Dessert keeps
            them all visible while Cake / Bread narrow further. */}
        {items.length > 0 && (
          <div
            role="tablist"
            aria-label={t('item.category')}
            style={{
              display: 'flex',
              gap: 6,
              flexWrap: 'wrap',
              paddingBottom: 4,
            }}
          >
            {POS_CAT_ORDER.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={posCat === key}
                onClick={() => setPosCat(key)}
                style={{
                  padding: '8px 14px',
                  fontSize: '0.875rem',
                  fontWeight: posCat === key ? 600 : 500,
                  background: posCat === key ? 'var(--color-primary)' : 'var(--color-surface)',
                  color: posCat === key ? '#fff' : 'var(--color-foreground)',
                  border: `1px solid ${posCat === key ? 'var(--color-primary)' : 'var(--color-border-strong)'}`,
                  borderRadius: 'var(--radius-pill, 999px)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  transition: 'background var(--transition-fast)',
                }}
              >
                {t(POS_CAT_DICT[key])}
              </button>
            ))}
          </div>
        )}

        {visibleItems.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 'var(--space-6)', color: 'var(--color-muted-fg)' }}>
            {items.length === 0 ? t('item.empty') : t('stocks.noMatch')}
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: 'var(--space-2)',
          }}>
            {visibleItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => addItem(item)}
                className="card"
                style={{
                  padding: 0,
                  overflow: 'hidden',
                  // Drop the 1 px .card border specifically on POS tiles —
                  // it shows as a thin lighter strip at the top edge of the
                  // image gradient where the contrast is highest. The shadow
                  // still gives the tile its lift; no border needed.
                  border: 'none',
                  display: 'flex', flexDirection: 'column',
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  transition: 'transform var(--transition-fast), box-shadow var(--transition-fast)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow = 'var(--shadow-md)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                <PosTile item={item} />
                <div style={{ padding: 'var(--space-2) var(--space-3)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {/* Tile typography tightened 2026-04-28 to match the
                      compact rhythm the Padauk Burmese font gives us in
                      MM mode. Whitespace-nowrap + ellipsis keeps long
                      English names like "Mini Butter Bread" from
                      wrapping awkwardly to two lines on a 200 px tile. */}
                  <div style={{
                    fontWeight: 600, fontSize: '0.8125rem', lineHeight: 1.3,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {item.name}
                  </div>
                  {/* Always render the Burmese row so every tile has the same
                      vertical footprint; an empty `nameLocal` becomes a
                      non-breaking space placeholder. Without this, items that
                      lack a Burmese name (e.g. drinks where the owner hasn't
                      filled the column yet) produce shorter tiles, and CSS
                      Grid stretches each row to its tallest member —
                      misaligning row 1 vs row 2 vs row 3. */}
                  <div lang="my" style={{
                    color: 'var(--color-muted-fg)', fontSize: '0.75rem', lineHeight: 1.3,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    // Reserve one line of vertical space even when nameLocal
                    // is null, so tile heights stay uniform across rows.
                    minHeight: 'calc(0.75rem * 1.3)',
                  }}>
                    {item.nameLocal || ' '}
                  </div>
                  <div style={{ marginTop: 2, color: 'var(--color-primary)', fontWeight: 600, fontSize: '0.875rem' }}>
                    <MMK amount={item.price} />
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ===== RIGHT: Cart + tender ===== */}
      <div className="card" style={{
        padding: 'var(--space-4)',
        display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
        overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: '1.0625rem', fontWeight: 600 }}>{t('pos.addItem')}</h2>
          {cart.length > 0 && (
            <button type="button" onClick={clearCart} className="btn btn-ghost btn-sm" style={{ color: 'var(--color-muted-fg)' }}>
              <X size={14} /> Clear
            </button>
          )}
        </div>

        {/* Cart lines */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {cart.length === 0 ? (
            <div style={{ color: 'var(--color-muted-fg)', textAlign: 'center', padding: 'var(--space-5)' }}>
              {t('pos.emptyTicket')}
            </div>
          ) : (
            cart.map((l) => (
              <div key={l.itemId} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: 'var(--space-2) var(--space-3)',
                background: 'var(--color-background)',
                borderRadius: 'var(--radius-sm)',
                gap: 'var(--space-2)',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, fontSize: '0.875rem', lineHeight: 1.3 }}>{l.name}</div>
                  <div style={{ color: 'var(--color-muted-fg)', fontSize: '0.75rem', lineHeight: 1.3, marginTop: 1 }}>
                    <MMK amount={l.unitPrice} /> × {l.qty} = <MMK amount={l.unitPrice * l.qty} />
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button type="button" onClick={() => changeQty(l.itemId, -1)} className="btn btn-ghost btn-sm" aria-label="Decrease" style={{ minHeight: 28, padding: '2px 8px' }}>
                    <Minus size={14} />
                  </button>
                  <span style={{ minWidth: 24, textAlign: 'center', fontWeight: 600 }}>{l.qty}</span>
                  <button type="button" onClick={() => changeQty(l.itemId, 1)} className="btn btn-ghost btn-sm" aria-label="Increase" style={{ minHeight: 28, padding: '2px 8px' }}>
                    <Plus size={14} />
                  </button>
                  <button type="button" onClick={() => removeLine(l.itemId)} className="btn btn-ghost btn-sm" aria-label={t('pos.voidLine')} style={{ minHeight: 28, padding: '2px 6px', color: 'var(--color-destructive)', marginLeft: 4 }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Totals */}
        {cart.length > 0 && (
          <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Row label={t('pos.subtotal')} value={<MMK amount={subtotal} />} />
            {/* Discount line — shows rate + negative MMK so cashier + customer
                can verify the bill arithmetic. Only renders when an actual
                amount is applied (Dis toggled AND non-zero pct typed). */}
            {discountTotal > 0 && (
              <Row label={`${t('pos.discount')} (${discountPctNum}%)`} value={<MMK amount={-discountTotal} />} />
            )}
            {/* Tax shows label only ("Tax (5%)") — owner brief 2026-04-28.
                Customers see the rate, not a separate kyat figure; total
                below already includes it (taxable base × 1.05 + delivery,
                where taxable base = subtotal − discount). */}
            {taxTotal > 0 && <Row label={t('slip.tax')} value={null} />}
            {deliveryNum > 0 && <Row label={t('pos.delivery')} value={<MMK amount={deliveryNum} />} />}
            <Row label={t('common.total')} value={<MMK amount={total} />} big />
          </div>
        )}

        {/* Cash chip + Tax toggle + Discount toggle + Delivery fee input
            share one 4-column row (owner brief 2026-05-21 — replaces the
            prior Cash + KBZ Pay + Delivery layout, then split the Tax box
            into Tax + Dis). Cash is informational (only tender method);
            Tax is the opt-in 5% toggle; Dis is the discount toggle (math
            pending owner spec). Cash tendered input lives alone on the
            row below so Enter-to-pay remains the obvious action. */}
        {cart.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.6fr)', gap: 4 }}>
              <TenderChip icon={<Banknote size={14} />}  label={t('pos.cashTender')}  active                    onClick={() => { /* only tender — kept as a status chip */ }} />
              <TenderChip icon={<Percent size={14} />}   label={t('pos.tax')}         active={taxApplied}       onClick={() => setTaxApplied((v) => !v)} />
              <TenderChip icon={<Tag size={14} />}       label="Dis"                  active={discountApplied}  onClick={() => {
                setDiscountApplied((v) => {
                  // Toggling off clears the pct so re-toggling on starts fresh
                  // instead of silently reapplying a stale rate.
                  if (v) setDiscountPct('');
                  return !v;
                });
              }} />
              <DeliveryFeeCell
                value={deliveryFee}
                onChange={setDeliveryFee}
                label={t('pos.delivery')}
              />
            </div>

            {/* Discount % input row — appears when the Dis chip is toggled
                on. Cashier types 0-100; out-of-range values clamp via
                discountPctNum in the math layer above. */}
            {discountApplied && (
              <div>
                <label htmlFor="pos-discount-pct" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Tag size={14} />
                  {t('pos.discount')} (%)
                </label>
                <input
                  id="pos-discount-pct"
                  type="number"
                  inputMode="numeric"
                  step="1"
                  min="0"
                  max="100"
                  value={discountPct}
                  onChange={(e) => setDiscountPct(e.target.value)}
                  placeholder="10"
                  autoFocus
                />
              </div>
            )}

            {tender === 'CASH' && (
              <div>
                <label htmlFor="pos-cash-tendered" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Banknote size={14} />
                  {t('pos.cashTender')}
                </label>
                <input
                  id="pos-cash-tendered"
                  type="number"
                  inputMode="numeric"
                  step="100"
                  min="0"
                  value={cashTendered}
                  onChange={(e) => setCashTendered(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !paying && cashNum >= total && cart.length > 0) {
                      e.preventDefault();
                      void pay();
                    }
                  }}
                  placeholder={total.toLocaleString()}
                />
              </div>
            )}

            {/* Status row under the side-by-side inputs — short-by /
                change is the thing the cashier actually checks before
                handing over the slip. Bold + colored for at-a-glance scan. */}
            {tender === 'CASH' && (cashNum > 0 || shortBy > 0) && (
              <div style={{ fontSize: '0.875rem', textAlign: 'right', fontWeight: 500 }}>
                {shortBy > 0 ? (
                  <span style={{ color: 'var(--color-destructive)' }}>Short by <MMK amount={shortBy} /></span>
                ) : (
                  <span style={{ color: 'var(--color-success)' }}>{t('pos.change')}: <MMK amount={change} /></span>
                )}
              </div>
            )}

            {error && (
              <div role="alert" style={{
                padding: '8px 12px',
                background: 'var(--color-destructive-bg)',
                color: 'var(--color-destructive)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.875rem',
              }}>{error}</div>
            )}

            <button
              type="button"
              className="btn btn-primary"
              style={{ fontSize: '1.0625rem', padding: '14px 16px', marginTop: 4 }}
              onClick={pay}
              disabled={paying || (tender === 'CASH' && cashNum < total)}
            >
              {paying ? 'Processing…' : <><Receipt size={18} /> {t('pos.payNow')}</>}
            </button>
          </div>
        )}
      </div>

      <style jsx>{`
        @media (max-width: 900px) {
          .pos-grid {
            grid-template-columns: 1fr !important;
            height: auto !important;
          }
        }
      `}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

// Dashed divider used throughout the receipt — mimics the look of a torn
// thermal slip. One visual element, zero thinking at call sites.
function Divider() {
  return (
    <div style={{
      borderTop: '1px dashed var(--color-border-strong)',
      margin: '8px 0',
    }} />
  );
}

// Image tile for POS cards. Always lays the warm-brown gradient as the base,
// then overlays the item photo on top when one is present. If the URL is
// broken or empty (a common state for stocks imported before photos were
// uploaded), the gradient shows through cleanly instead of the previous
// cream "no-image" colour band that left tiles looking inconsistent.
function PosTile({ item }: { item: CatalogItem }) {
  // Hardened imageUrl check: whitespace-only or empty strings (a leftover of
  // earlier imports) should fall through to the fallback gradient + letter,
  // not render as a broken `url(" ")` background that drops the cover layer.
  const url = item.imageUrl?.trim();
  const gradient = 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-accent) 100%)';
  const background = url
    ? `url("${url}") center/cover no-repeat, ${gradient}`
    : gradient;
  return (
    <div style={{
      aspectRatio: '1 / 1',
      width: '100%',
      background,
      // Match the parent card's top corners so the gradient/photo aligns with
      // the rounded edge. Without this, browsers leave a thin sliver of the
      // parent .card cream background visible at the curve where the child's
      // straight corner meets the parent's `overflow: hidden + border-radius`
      // clip path — visible most as a faint stripe at the top of "A" tiles.
      borderTopLeftRadius: 'var(--radius-md)',
      borderTopRightRadius: 'var(--radius-md)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff',
      fontFamily: 'var(--font-display)',
      fontSize: '2.5rem',
      fontWeight: 700,
    }}>
      {!url && (item.name?.[0] ?? 'P').toUpperCase()}
    </div>
  );
}

function Row({ label, value, big = false }: { label: string; value: React.ReactNode; big?: boolean }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      // Tightened 2026-04-28 to match the visual rhythm Burmese gives us.
      // Burmese characters render with thinner strokes than Inter; matching
      // weights pull the EN UI toward the same calm density.
      fontSize: big ? '1.0625rem' : '0.875rem',
      fontWeight: big ? 700 : 400,
      color: big ? 'var(--color-foreground)' : 'var(--color-muted-fg)',
    }}>
      <span>{label}</span>
      <span style={{ color: big ? 'var(--color-primary)' : undefined }}>{value}</span>
    </div>
  );
}

function TenderChip({ icon, label, active, onClick }: {
  icon: React.ReactNode; label: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
        padding: '6px 8px',
        background: active ? 'var(--color-primary)' : 'var(--color-surface)',
        color: active ? '#fff' : 'var(--color-foreground)',
        border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border-strong)'}`,
        borderRadius: 'var(--radius-sm)',
        cursor: 'pointer',
        fontFamily: 'inherit',
        fontSize: '0.8125rem',
        fontWeight: active ? 600 : 500,
        minHeight: 36,
        lineHeight: 1.1,
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

// Shares TenderChip's visual family (height, border, radius, surface) but
// is a label-wrapped numeric input. Truck icon left, input fills the rest
// — gives the cashier a wide, comfortable number field while Cash/KBZ stay
// compact (owner brief 2026-05-19).
function DeliveryFeeCell({ value, onChange, label }: {
  value: string; onChange: (v: string) => void; label: string;
}) {
  return (
    <label
      htmlFor="pos-delivery-fee"
      style={{
        display: 'inline-flex', flexDirection: 'row', alignItems: 'center', gap: 6,
        padding: '6px 10px',
        background: 'var(--color-surface)',
        color: 'var(--color-foreground)',
        border: '1px solid var(--color-border-strong)',
        borderRadius: 'var(--radius-sm)',
        fontFamily: 'inherit',
        fontSize: '0.8125rem',
        fontWeight: 500,
        minHeight: 36,
        cursor: 'text',
      }}
    >
      <Truck size={14} />
      <input
        id="pos-delivery-fee"
        type="number"
        inputMode="numeric"
        step="100"
        min="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={label}
        style={{
          flex: 1, minWidth: 0,
          border: 'none', background: 'transparent', outline: 'none',
          textAlign: 'right', padding: 0,
          fontFamily: 'inherit', fontSize: '0.8125rem', color: 'inherit',
          lineHeight: 1.1,
        }}
      />
    </label>
  );
}

/**
 * Receipt view — split into two clearly-labeled regions:
 *
 *   1. CUSTOMER SECTION (.customer-receipt)
 *        Shop name · receipt# · line items · totals · change · thank-you.
 *        This is the only block printed when the cashier hits "Print".
 *        Everything else is hidden via @media print { .staff-only { display:none } }.
 *
 *   2. STAFF-ONLY SECTION (.staff-only)
 *        Ingredient deductions, back-office audit info. Lives below a
 *        locked banner so cashiers understand it's not for the customer.
 *        Automatically hidden on print AND when print-preview renders.
 *
 * The cashier gets one full view on screen; the customer gets a clean slip.
 */
function ReceiptView({ receipt, cart, items, onClose, t }: {
  receipt: SaleResponse;
  cart: CartLine[];            // frozen snapshot taken at pay time
  items: CatalogItem[];        // used to look up `nameLocal` by itemId
  onClose: () => void;
  t: ReturnType<typeof useT>;
}) {
  const s = receipt.sale;

  // Build a Map<itemId, nameLocal> once so the bilingual lines computation
  // stays O(n) even with hundreds of menu items.
  const itemsById = useMemo(() => {
    const m = new Map<string, CatalogItem>();
    for (const it of items) m.set(it.id, it);
    return m;
  }, [items]);

  // Cart snapshot + nameLocal → the shape the canvas renderer consumes.
  const bilingualLines = useMemo(
    () => cart.map((c) => ({
      qty: c.qty,
      name: c.name,
      nameLocal: itemsById.get(c.itemId)?.nameLocal ?? null,
      unitPrice: c.unitPrice,
      lineTotal: c.unitPrice * c.qty,
    })),
    [cart, itemsById],
  );

  // Network-print state. Client rasterises the bilingual slip via canvas
  // (the only way to render Myanmar — Epson firmware has no Burmese
  // codepage), POSTs the 1-bpp bitmap to /api/print, server wraps with
  // native barcode + cut and streams to PRINTER_HOST:9100.
  const [printStatus, setPrintStatus] = useState<'idle' | 'busy' | 'ok' | 'err'>('idle');
  const [printError, setPrintError] = useState('');

  const doPrint = useCallback(async () => {
    setPrintStatus('busy');
    setPrintError('');
    try {
      const rendered = await renderReceiptCanvas({
        sale: s,
        lines: bilingualLines,
        t,
        tEnMy: trBoth,
      });
      const res = await fetch('/api/print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bitmapBase64: rendered.bitmapBase64,
          widthPx: rendered.widthPx,
          heightPx: rendered.heightPx,
          // Offline sales don't have a server-assigned receiptNumber yet
          // (it lands on drain). Fall back to the ULID so the barcode
          // always prints — and so the print route's Zod schema, which
          // requires a non-empty string, doesn't reject the request.
          barcodeValue: s.receiptNumber ?? s.id,
          openDrawer: s.tenderType === 'CASH',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setPrintStatus('ok');
    } catch (e) {
      setPrintStatus('err');
      setPrintError((e as Error).message);
    }
  }, [s, bilingualLines, t]);

  // Auto-print once on mount. useRef guards against React 18 StrictMode
  // running mount effects twice in dev — we never want two physical jobs.
  //
  // Wait briefly for the server-assigned receiptNumber before printing so
  // the paper barcode shows "PKY00042" not the ULID fallback. The outbox
  // drain takes ~300ms on local Postgres; we cap the wait at 2s so that
  // truly offline sales still print (with ULID) and the customer doesn't
  // stand at the counter waiting.
  const autoRan = useRef(false);
  useEffect(() => {
    if (autoRan.current) return;
    if (s.receiptNumber !== null) {
      autoRan.current = true;
      void doPrint();
      return;
    }
    const timeoutId = setTimeout(() => {
      if (autoRan.current) return;
      autoRan.current = true;
      void doPrint();
    }, 2000);
    return () => clearTimeout(timeoutId);
  }, [doPrint, s.receiptNumber]);
  return (
    <div className="receipt-wrap" style={{ maxWidth: 360, margin: '0 auto', padding: 'var(--space-4)' }}>
      {/* ───── CUSTOMER RECEIPT ─────
           Formatted like a traditional thermal slip. No "Paid" banner —
           the slip itself IS the confirmation. Prints cleanly on 80mm. */}
      <div className="customer-receipt card" style={{
        padding: 'var(--space-5) var(--space-4)',
        display: 'flex', flexDirection: 'column',
        fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, monospace)',
        fontSize: '0.875rem',
        lineHeight: 1.45,
      }}>
        {/* Shop header — visible on both screen and print */}
        <div className="slip-header" style={{ textAlign: 'center', marginBottom: 'var(--space-3)' }}>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1.125rem', fontWeight: 800,
            letterSpacing: '0.02em',
            color: 'var(--color-primary)',
          }}>
            Pae Ka Yauk
          </div>
          <div lang="my" style={{
            fontFamily: 'var(--font-myanmar)',
            fontSize: '1rem',
            color: 'var(--color-foreground)',
            marginTop: 2,
          }}>
            ပဲကရောက်
          </div>
          <div style={{
            fontSize: '0.6875rem',
            color: 'var(--color-muted-fg)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            marginTop: 4,
          }}>
            Coffee & Bakery
          </div>
        </div>

        <Divider />

        {/* Meta — Date only. Receipt number is shown beneath the barcode at
            the bottom of the slip; printing it twice was noisy. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 12px', fontSize: '0.8125rem' }}>
          <span style={{ color: 'var(--color-muted-fg)' }}>Date</span>
          <span style={{ textAlign: 'right' }}>{new Date(s.createdAt).toLocaleString(undefined, {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit',
          })}</span>
        </div>

        <Divider />

        {/* Line items — single-row "English (Myanmar) x qty" on left, line
            total on right. Bilingual names come from the cart snapshot so
            they match what prints on the thermal slip. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {bilingualLines.map((l, i) => (
            <div key={i} style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto',
              columnGap: 8,
              padding: '2px 0',
            }}>
              <div>
                <span style={{ fontWeight: 500 }}>
                  {l.name}
                  {l.nameLocal && (
                    <span lang="my" style={{ fontFamily: 'var(--font-myanmar)' }}>
                      {' '}({l.nameLocal})
                    </span>
                  )} x {l.qty}
                </span>
                <div style={{ color: 'var(--color-muted-fg)', fontSize: '0.6875rem' }}>
                  @ <MMK amount={l.unitPrice} />
                </div>
              </div>
              <div style={{ textAlign: 'right', fontWeight: 500 }} className="tabular-nums">
                <MMK amount={l.lineTotal} />
              </div>
            </div>
          ))}
        </div>

        <Divider />

        {/* Totals block */}
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 12px', fontSize: '0.8125rem' }}>
          <span style={{ color: 'var(--color-muted-fg)' }}>{t('pos.subtotal')}</span>
          <span className="tabular-nums" style={{ textAlign: 'right' }}><MMK amount={s.subtotal} /></span>
          {s.discountTotal > 0 && (
            <>
              {/* Discount line shows rate + negative amount so the customer
                  can verify the bill arithmetic line by line. */}
              <span style={{ color: 'var(--color-muted-fg)' }}>{t('slip.discount')} ({s.discountPct}%)</span>
              <span className="tabular-nums" style={{ textAlign: 'right' }}><MMK amount={-s.discountTotal} /></span>
            </>
          )}
          {s.taxTotal > 0 && (
            <>
              {/* Slip shows "Tax (5%)" label only — no kyat figure. Total
                  below is tax-inclusive (taxable base × 1.05 + delivery,
                  where taxable base = subtotal − discount) so customers
                  can verify by arithmetic. */}
              <span style={{ color: 'var(--color-muted-fg)' }}>{t('slip.tax')}</span>
              <span />
            </>
          )}
          {s.deliveryFee > 0 && (
            <>
              <span style={{ color: 'var(--color-muted-fg)' }}>{t('slip.delivery')}</span>
              <span className="tabular-nums" style={{ textAlign: 'right' }}><MMK amount={s.deliveryFee} /></span>
            </>
          )}
        </div>

        {/* Total — emphasised row */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          gap: '0 12px',
          padding: '8px 0',
          marginTop: 6,
          borderTop: '2px solid var(--color-foreground)',
          borderBottom: '1px dashed var(--color-border-strong)',
          fontWeight: 700,
        }}>
          <span>{t('common.total')}</span>
          <span className="tabular-nums" style={{ textAlign: 'right', fontSize: '1rem', color: 'var(--color-primary)' }}>
            <MMK amount={s.total} />
          </span>
        </div>

        {/* Payment + change */}
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 12px', fontSize: '0.8125rem', marginTop: 6 }}>
          <span style={{ color: 'var(--color-muted-fg)' }}>
            {t('pos.tendered')} <span style={{ fontSize: '0.6875rem', opacity: 0.7 }}>({s.tenderType.replace(/_/g, ' ').toLowerCase()})</span>
          </span>
          <span className="tabular-nums" style={{ textAlign: 'right' }}><MMK amount={s.amountTendered} /></span>
          {s.changeGiven > 0 && (
            <>
              <span style={{ color: 'var(--color-muted-fg)' }}>{t('pos.change')}</span>
              <span className="tabular-nums" style={{ textAlign: 'right', fontWeight: 600 }}><MMK amount={s.changeGiven} /></span>
            </>
          )}
        </div>

        <Divider />

        {/* Thank-you */}
        <div style={{ textAlign: 'center', marginTop: 6, marginBottom: 'var(--space-3)' }}>
          <div style={{ fontSize: '0.8125rem', color: 'var(--color-foreground)', fontWeight: 500 }}>
            Thank you for your visit
          </div>
          <div lang="my" style={{
            fontSize: '0.8125rem',
            fontFamily: 'var(--font-myanmar)',
            color: 'var(--color-muted-fg)',
            marginTop: 2,
          }}>
            ဝယ်ယူအားပေးမှုကိုအထူးကျေးဇူးတင်ရှိပါသည်။
          </div>
        </div>

        {/* Barcode — scannable. Offline sales have no server receipt
            number yet, so we encode the ULID instead — same value the
            print route stamps on the printed slip. */}
        <div style={{ padding: '6px 0 4px' }}>
          <ReceiptBarcode value={s.receiptNumber ?? s.id} />
          <div style={{
            textAlign: 'center',
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: '0.75rem',
            letterSpacing: '0.15em',
            color: 'var(--color-muted-fg)',
            marginTop: 4,
          }}>
            {s.receiptNumber ?? '—'}
          </div>
        </div>
      </div>

      {/* ───── STAFF-ONLY AUDIT BLOCK ─────
           Cashier can see ingredient deductions. Never printed. Never seen by customer. */}
      {(receipt.deductions ?? []).length > 0 && (
        <div className="staff-only no-print" style={{
          marginTop: 'var(--space-3)',
          padding: 'var(--space-3)',
          background: 'var(--color-surface-alt)',
          border: '1px dashed var(--color-border-strong)',
          borderRadius: 'var(--radius-sm)',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: '0.75rem', fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.06em',
            color: 'var(--color-muted-fg)',
            marginBottom: 6,
          }}>
            <Lock size={12} /> Staff only · not printed
          </div>
          <details style={{ fontSize: '0.8125rem', color: 'var(--color-muted-fg)' }}>
            <summary style={{ cursor: 'pointer' }}>Stock deducted ({(receipt.deductions ?? []).length})</summary>
            <ul style={{ marginTop: 4, paddingLeft: 20 }}>
              {(receipt.deductions ?? []).map((d, i) => (
                <li key={i}>
                  {d.qty.toLocaleString(undefined, { maximumFractionDigits: 6 })} {d.unit} · material {d.materialId.slice(0, 8)}…
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}

      {/* Actions — hidden on print */}
      <div className="no-print" style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={doPrint}
          disabled={printStatus === 'busy'}
        >
          <Printer size={16} />
          {printStatus === 'busy' ? t('pos.printing')
            : printStatus === 'ok' ? t('pos.printed')
            : t('pos.print')}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          New Sale
        </button>
      </div>

      {/* Printer error — only shown when a network-print attempt failed */}
      {printStatus === 'err' && (
        <div
          role="alert"
          className="no-print"
          style={{
            padding: '8px 12px',
            marginTop: 'var(--space-2)',
            background: 'var(--color-destructive-bg)',
            color: 'var(--color-destructive)',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.875rem',
          }}
        >
          {t('pos.printFailed')}
          {printError && <span style={{ opacity: 0.75 }}> · {printError}</span>}
        </div>
      )}

      {/* ───── PRINT-MODE CSS ─────
           Same layout renders on screen and print — we just strip the app
           chrome, set page size for 80mm thermal, and force black ink so
           the warm browns don't waste colour ribbon on receipt printers. */}
      <style jsx global>{`
        @media print {
          @page { size: 80mm auto; margin: 3mm; }
          body { background: white !important; }
          header, aside, nav, footer, .no-print, .staff-only,
          [role="banner"], [role="navigation"], [role="contentinfo"] {
            display: none !important;
          }
          .receipt-wrap {
            max-width: none !important;
            padding: 0 !important;
            margin: 0 !important;
          }
          .customer-receipt {
            border: none !important;
            box-shadow: none !important;
            padding: 0 !important;
            background: white !important;
            color: black !important;
          }
          .customer-receipt * {
            color: black !important;
          }
        }
      `}</style>
    </div>
  );
}
