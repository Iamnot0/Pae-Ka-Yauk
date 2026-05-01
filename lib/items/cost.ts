/**
 * Pure cost-display helper, isolated from `lib/repos/items.ts` so client
 * components can import it without dragging in `@/lib/neonHttp` (which
 * calls `neon()` at module load and explodes on the client when
 * DATABASE_URL is undefined).
 *
 * Caller: components/stocks/StocksTable.tsx (and any future Stocks-page UI).
 */

import type { InventoryMode } from '@/lib/featureMode';

/**
 * Compute the cost figure to display in the Stocks table or detail view.
 * In FULL mode, prefer the recipe-derived cost when available; fall back
 * to the owner-entered manualCost. In POS_PAUSED mode, recipes don't drive
 * cost — always use manualCost. Returns null if neither is set.
 */
export function resolveDisplayCost(
  item: { manualCost: number | null; recipeCost: number | null },
  mode: InventoryMode,
): number | null {
  if (mode === 'FULL') return item.recipeCost ?? item.manualCost;
  return item.manualCost;
}
