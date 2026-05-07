/**
 * Pure helper that turns a PendingOp (raw outbox row) into a human-readable
 * summary the SyncStatusPill / SyncStatus page can render.
 *
 * Boss's UX requirement (2026-05-07):
 *   "if some failed to sync, show what is failed exactly — slip ID with
 *    date and description; click brief to see full details of the slip."
 *
 * Output shape is intentionally render-friendly:
 *   - `title`     short, scannable (e.g. "Sale · 1,250 MMK · 3 items")
 *   - `subtitle`  date + endpoint (e.g. "23:04 · /api/sales")
 *   - `details`   {label, value} list for the expand panel
 *   - `humanId`   shop-friendly identifier when available (slip number when
 *                 the server already minted one; ULID prefix as fallback)
 */
import type { PendingOp } from './db';

export interface OpSummary {
  title: string;
  subtitle: string;
  humanId: string;
  details: Array<{ label: string; value: string }>;
  /** Truthy if the op carries a server-side error worth surfacing prominently */
  errorMessage: string | null;
}

const MMK = new Intl.NumberFormat('en-US');
const TIME_HM = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Asia/Yangon',
});
const DATE_DMY = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Yangon',
});

function formatYangonDateTime(ms: number): { time: string; date: string } {
  const d = new Date(ms);
  return { time: TIME_HM.format(d), date: DATE_DMY.format(d) };
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

interface SaleLineLike {
  name?: unknown;
  itemName?: unknown;
  qty?: unknown;
  quantity?: unknown;
  unitPrice?: unknown;
  price?: unknown;
  lineTotal?: unknown;
}

function describeSaleLines(payload: Record<string, unknown>): {
  count: number;
  total: number | null;
  itemNames: string[];
} {
  const lines = Array.isArray(payload.lines) ? (payload.lines as SaleLineLike[]) : [];
  const total =
    asNumber(payload.total) ??
    asNumber(payload.grandTotal) ??
    lines.reduce<number>((sum, l) => sum + (asNumber(l.lineTotal) ?? (asNumber(l.qty ?? l.quantity) ?? 0) * (asNumber(l.unitPrice ?? l.price) ?? 0)), 0);

  const itemNames = lines
    .map((l) => asString(l.name) ?? asString(l.itemName))
    .filter((s): s is string => !!s);

  return { count: lines.length, total: total === null ? null : total, itemNames };
}

export function summarizeOp(op: PendingOp): OpSummary {
  const { time, date } = formatYangonDateTime(op.createdAt);
  const idShort = op.id.slice(-8).toUpperCase();
  const subtitleBase = `${date} · ${time}`;

  // /api/sales — the most common failure case Boss cares about
  if (op.endpoint === '/api/sales') {
    const { count, total, itemNames } = describeSaleLines(op.payload);
    const receiptNumber = asString(op.payload.receiptNumber);
    const humanId = receiptNumber ?? `…${idShort}`;
    const totalLabel = total !== null ? `${MMK.format(Math.round(total))} MMK` : '— MMK';
    const itemLabel = count === 1 ? '1 item' : `${count} items`;
    const itemList = itemNames.length > 0 ? itemNames.slice(0, 4).join(', ') + (itemNames.length > 4 ? '…' : '') : '—';
    return {
      title: `Sale ${humanId} · ${totalLabel} · ${itemLabel}`,
      subtitle: `${subtitleBase} · /api/sales`,
      humanId,
      errorMessage: op.lastError ?? null,
      details: [
        { label: 'Slip', value: humanId },
        { label: 'Date', value: `${date} ${time} (Yangon)` },
        { label: 'Total', value: totalLabel },
        { label: 'Items', value: itemList },
        { label: 'Lines', value: String(count) },
        { label: 'Payment', value: asString(op.payload.paymentMethod) ?? '—' },
        { label: 'Mode', value: op.modeAtCreation },
        { label: 'Op ID (ULID)', value: op.id },
        { label: 'Attempts', value: String(op.attemptCount) },
      ],
    };
  }

  // /api/production — baker logged a batch
  if (op.endpoint === '/api/production') {
    const itemName = asString(op.payload.itemName) ?? asString(op.payload.name) ?? '(unknown item)';
    const qty = asNumber(op.payload.actualYield) ?? asNumber(op.payload.qty);
    const qtyLabel = qty !== null ? `${qty}` : '—';
    return {
      title: `Bake · ${itemName} · ${qtyLabel}`,
      subtitle: `${subtitleBase} · /api/production`,
      humanId: `…${idShort}`,
      errorMessage: op.lastError ?? null,
      details: [
        { label: 'Item', value: itemName },
        { label: 'Yield', value: qtyLabel },
        { label: 'Date', value: `${date} ${time} (Yangon)` },
        { label: 'Op ID (ULID)', value: op.id },
        { label: 'Attempts', value: String(op.attemptCount) },
      ],
    };
  }

  // /api/stocks/receive — owner credited finished-goods stock
  if (op.endpoint === '/api/stocks/receive') {
    const itemName = asString(op.payload.itemName) ?? '(unknown item)';
    const qty = asNumber(op.payload.qty) ?? asNumber(op.payload.quantity);
    return {
      title: `Receive · ${itemName} · ${qty ?? '—'}`,
      subtitle: `${subtitleBase} · /api/stocks/receive`,
      humanId: `…${idShort}`,
      errorMessage: op.lastError ?? null,
      details: [
        { label: 'Item', value: itemName },
        { label: 'Qty', value: qty !== null ? String(qty) : '—' },
        { label: 'Cost', value: asNumber(op.payload.unitCost) !== null ? `${MMK.format(asNumber(op.payload.unitCost)!)} MMK` : '—' },
        { label: 'Note', value: asString(op.payload.note) ?? '—' },
        { label: 'Date', value: `${date} ${time} (Yangon)` },
        { label: 'Op ID (ULID)', value: op.id },
      ],
    };
  }

  // /api/stocks/adjust — DMG / FOC / SPOILED / OTHER
  if (op.endpoint === '/api/stocks/adjust') {
    const itemName = asString(op.payload.itemName) ?? '(unknown item)';
    const category = asString(op.payload.category) ?? 'ADJUST';
    const qty = asNumber(op.payload.qty);
    return {
      title: `Adjust ${category} · ${itemName} · ${qty ?? '—'}`,
      subtitle: `${subtitleBase} · /api/stocks/adjust`,
      humanId: `…${idShort}`,
      errorMessage: op.lastError ?? null,
      details: [
        { label: 'Item', value: itemName },
        { label: 'Category', value: category },
        { label: 'Qty', value: qty !== null ? String(qty) : '—' },
        { label: 'Reason', value: asString(op.payload.reason) ?? '—' },
        { label: 'Date', value: `${date} ${time} (Yangon)` },
        { label: 'Op ID (ULID)', value: op.id },
      ],
    };
  }

  // Fallback — unknown endpoint, render generic info
  return {
    title: `${op.endpoint} · …${idShort}`,
    subtitle: subtitleBase,
    humanId: `…${idShort}`,
    errorMessage: op.lastError ?? null,
    details: [
      { label: 'Endpoint', value: op.endpoint },
      { label: 'Date', value: `${date} ${time} (Yangon)` },
      { label: 'Op ID (ULID)', value: op.id },
      { label: 'Attempts', value: String(op.attemptCount) },
    ],
  };
}
