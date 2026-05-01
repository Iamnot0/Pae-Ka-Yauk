/**
 * Today's sales merged view — what the cashier actually wants to see on
 * the POS bottom panel. Combines:
 *
 *   - confirmed:  rows from `/api/sales/today`  (server-acknowledged)
 *   - pending:    pendingOps in IDB where endpoint = '/api/sales' (queued)
 *
 * Dedup is by ULID — the same id appears in both lists during the brief
 * window between server-ack and the IDB row being deleted, so we always
 * prefer the server-confirmed row when both exist.
 *
 * UI styling: pending rows render faded (`_pending: true`) so the cashier
 * can tell at a glance which slips have synced. Once the drain succeeds,
 * the row drops out of `pending` and the panel re-renders solid.
 */

import { listPending } from './outbox';

export interface TodaysSale {
  id: string;
  receiptNumber: string | null;
  total: number;
  itemCount: number;
  tenderType: string;
  createdAt: number;
  /** true → still in IDB outbox; false → server-confirmed */
  _pending: boolean;
}

export async function getTodaysSales(): Promise<TodaysSale[]> {
  const [serverList, pendingOps] = await Promise.all([
    fetchServerToday(),
    listPending('pending'),
  ]);

  const seen = new Set<string>();
  const out: TodaysSale[] = [];

  for (const row of serverList) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push({ ...row, _pending: false });
  }

  for (const op of pendingOps) {
    if (op.endpoint !== '/api/sales') continue;
    if (seen.has(op.id)) continue;
    seen.add(op.id);
    const payload = op.payload as {
      lines?: Array<{ qty?: number }>;
      tenderType?: string;
      receiptNumber?: string;
    };
    const lines = payload.lines ?? [];
    const itemCount = lines.reduce((s, l) => s + (l.qty ?? 0), 0);
    out.push({
      id: op.id,
      receiptNumber: payload.receiptNumber ?? null,
      // Total is unknown locally without re-running tax math; show 0 and
      // let the slip-level UI carry the real total. Cashier panel
      // displays "(syncing)" instead of a number for pending rows.
      total: 0,
      itemCount,
      tenderType: payload.tenderType ?? 'CASH',
      createdAt: op.createdAt,
      _pending: true,
    });
  }

  return out.sort((a, b) => b.createdAt - a.createdAt);
}

interface ServerSaleRow {
  id: string;
  receiptNumber: string | null;
  total: number;
  itemCount: number;
  tenderType: string;
  createdAt: number;
}

async function fetchServerToday(): Promise<ServerSaleRow[]> {
  if (typeof window === 'undefined' || !navigator.onLine) return [];
  try {
    const r = await fetch('/api/sales/today', { cache: 'no-store' });
    if (!r.ok) return [];
    const j = (await r.json()) as { rows?: Array<{
      id: string; receiptNumber: string | null; total: number;
      itemCount: number; tenderType: string; createdAt: string | number;
    }> };
    return (j.rows ?? []).map((r) => ({
      id: r.id,
      receiptNumber: r.receiptNumber,
      total: Number(r.total),
      itemCount: Number(r.itemCount),
      tenderType: r.tenderType,
      createdAt: typeof r.createdAt === 'string' ? Date.parse(r.createdAt) : r.createdAt,
    }));
  } catch {
    return [];
  }
}
