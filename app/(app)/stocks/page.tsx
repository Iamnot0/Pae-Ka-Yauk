import { requireUser } from '@/lib/auth';
import { getStocks } from '@/lib/repos/stocks';
import { getInventoryMode } from '@/lib/featureMode';
import { StocksTable } from '@/components/stocks/StocksTable';

export default async function StocksPage() {
  const user = await requireUser();
  // Initial render is "today" — the table re-fetches on time-window toggle
  // via a client-side useEffect, so this just hydrates the first paint.
  const [initial, mode] = await Promise.all([
    getStocks(user.tenantId, 'today'),
    getInventoryMode(user.tenantId),
  ]);
  return <StocksTable initial={initial} userRole={user.role} mode={mode} />;
}
