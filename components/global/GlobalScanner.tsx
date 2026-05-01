'use client';

/**
 * Global barcode-scanner listener — active on every authenticated route.
 *
 * Behavior:
 *   - User scans anywhere in the (app) section (Dashboard, Stocks, Inventory,
 *     Reports, Recipes, etc).
 *   - We push to /pos?scan=<code>.
 *   - If the user was already on /pos, the URL just gains the ?scan param —
 *     PosScreen's useEffect picks it up, looks up the SKU, adds to cart.
 *   - If the user was elsewhere, this becomes a real navigation. They land
 *     on POS with the item already in the cart.
 *
 * Why URL-param instead of context/event:
 *   The same code path serves both "scan on POS" and "scan from anywhere".
 *   Bookmarkable side-effect: a deep link like `/pos?scan=61085341` adds
 *   the item too — useful for testing without a physical scanner.
 *
 * The hook itself ignores keystrokes when an editable element is focused
 * (prevents accidental triggers during cash entry, search typing, etc.)
 */

import { useRouter } from 'next/navigation';
import { useBarcodeScanner } from '@/lib/hooks/useBarcodeScanner';

export function GlobalScanner() {
  const router = useRouter();

  useBarcodeScanner({
    onScan: (code) => {
      router.push(`/pos?scan=${encodeURIComponent(code)}`);
    },
  });

  return null;
}
