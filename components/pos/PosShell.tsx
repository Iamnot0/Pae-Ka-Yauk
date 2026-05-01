'use client';

/**
 * PosShell — Phase 2 cashier entry point. Reads the catalog from IndexedDB
 * (Hard Rule #17), not from the server, so the POS still rings up sales
 * when the device is offline.
 *
 * Lifecycle:
 *   1. Mount → read getCatalogLocal(). If we have a payload, render PosScreen
 *      immediately (no spinner — IDB is sync-fast).
 *   2. Subscribe to onCatalogUpdate(). When the global SWR loop in
 *      OfflineBoot publishes a fresher catalog, our state updates and
 *      PosScreen re-renders with the new items.
 *   3. If IDB was empty on mount AND the SWR loop didn't fill it within
 *      ~3s, show <NoCatalogYet />. After day-one setup this branch never
 *      fires — the cache survives reloads.
 *
 * Why not pre-render server-side: Hard Rule #16 routes writes through the
 * outbox; routing reads through IDB makes the offline contract symmetric.
 * Server-side fetch on /pos would be authoritative-but-online-only, which
 * defeats the whole point of Phase 2.
 */

import { useEffect, useState } from 'react';
import { onCatalogUpdate, getCatalogLocal } from '@/lib/client/catalog';
import type { CatalogPayload } from '@/lib/repos/catalog';
import { PosScreen } from './PosScreen';
import { NoCatalogYet } from './NoCatalogYet';

type PosState =
  | { kind: 'loading' }
  | { kind: 'ready'; items: CatalogPayload['items'] }
  | { kind: 'empty' };

export function PosShell() {
  const [state, setState] = useState<PosState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<boolean> => {
      const entry = await getCatalogLocal();
      if (cancelled) return false;
      const payload = entry?.payload as CatalogPayload | undefined;
      if (payload?.items?.length) {
        setState({ kind: 'ready', items: payload.items });
        return true;
      }
      return false;
    };

    // Try immediately. If empty, give the SWR loop ~3s to populate before
    // surfacing the first-launch fallback. The loop fires on mount of
    // OfflineBoot in the layout, so by the time we render this is usually
    // a no-op — but on a cold first-launch the network race matters.
    void (async () => {
      const found = await load();
      if (found) return;

      const timeoutId = setTimeout(() => {
        if (!cancelled) setState({ kind: 'empty' });
      }, 3000);

      // Subscribe so a successful refresh during the 3s window flips to
      // 'ready' instead of falling through to NoCatalogYet.
      const unsub = onCatalogUpdate(() => {
        void load().then((ok) => { if (ok) clearTimeout(timeoutId); });
      });

      return () => {
        clearTimeout(timeoutId);
        unsub();
      };
    })();

    // Independent subscription for steady-state updates after the initial
    // load — picks up "owner edited a price in /stocks" → POS re-renders.
    const unsub = onCatalogUpdate(() => { void load(); });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  if (state.kind === 'loading') {
    // IDB read is fast (single keyed get); a flash here is tens of ms.
    // Render an empty container so layout doesn't jump.
    return <div style={{ minHeight: '60vh' }} aria-busy="true" />;
  }

  if (state.kind === 'empty') {
    return <NoCatalogYet onSuccess={() => setState({ kind: 'loading' })} />;
  }

  return <PosScreen items={state.items} />;
}
