'use client';

/**
 * Single mount point for Phase 2's client-side machinery:
 *
 *   - register the active tenant slug (so catalog cache is keyed correctly)
 *   - cache the active inventory mode (so outbox stamps it on offline writes)
 *   - install the catalog SWR refresh loop (mount + online + 60s)
 *   - install the outbox drain loop (post-enqueue + online + 15s)
 *   - reclaim any orphan `inflight` ops left from a tab crash
 *
 * Mounted once in `app/(app)/layout.tsx` next to `<Header>`. Rendering null
 * keeps it invisible; all side-effects are in `useEffect`.
 */

import { useEffect } from 'react';
import { setTenantSlug, startCatalogSwrLoop } from '@/lib/client/catalog';
import { setCachedMode } from '@/lib/client/outbox';
import { startDrainLoop } from '@/lib/client/drain';
import type { InventoryMode } from '@/lib/featureMode';

interface Props {
  tenantSlug: string;
  inventoryMode: InventoryMode;
}

export function OfflineBoot({ tenantSlug, inventoryMode }: Props) {
  useEffect(() => {
    let teardownCatalog: (() => void) | null = null;
    let teardownDrain: (() => void) | null = null;

    void setTenantSlug(tenantSlug);
    setCachedMode(inventoryMode);
    teardownCatalog = startCatalogSwrLoop();
    teardownDrain = startDrainLoop();

    return () => {
      teardownCatalog?.();
      teardownDrain?.();
    };
  }, [tenantSlug, inventoryMode]);

  return null;
}
