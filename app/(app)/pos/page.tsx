import { requireUser } from '@/lib/auth';
import { PosShell } from '@/components/pos/PosShell';

/**
 * /pos — server component reduced to an auth gate.
 *
 * The catalog is no longer fetched here. Per Hard Rule #17, cashier reads
 * go through `lib/client/catalog.ts → getCatalogLocal()` (IndexedDB), and
 * the global SWR loop in OfflineBoot keeps it fresh. PosShell wires those
 * pieces together; this page just makes sure there is a logged-in user
 * before the client mounts.
 */
export default async function PosPage() {
  await requireUser();
  return <PosShell />;
}
