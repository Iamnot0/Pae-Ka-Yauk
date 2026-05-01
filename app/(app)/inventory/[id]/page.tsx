import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { readSession } from '@/lib/auth';
import { getMaterial } from '@/lib/repos/materials';
import { listActiveBatches, listMovements, getOnHand } from '@/lib/stock/ledger';
import { MaterialDetail } from '@/components/inventory/MaterialDetail';

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
};

export default async function EditMaterialPage({ params, searchParams }: Props) {
  const [session, { id }, sp] = await Promise.all([readSession(), params, searchParams]);
  if (!session) redirect('/login');
  const tab = (sp.tab === 'batches' || sp.tab === 'movements') ? sp.tab : 'edit';

  const material = await getMaterial(session.tenantId, id);
  if (!material) notFound();

  // Only load tab-specific data when that tab is active (keeps navigation snappy)
  const [batches, movements, onHand] = await Promise.all([
    tab === 'batches' ? listActiveBatches(session.tenantId, id) : Promise.resolve([]),
    tab === 'movements' ? listMovements(session.tenantId, id, { limit: 200 }) : Promise.resolve([]),
    getOnHand(session.tenantId, id),
  ]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <Link
        href="/inventory"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)',
          color: 'var(--color-muted-fg)', textDecoration: 'none',
          fontSize: '0.9375rem', width: 'fit-content',
        }}
      >
        <ChevronLeft size={16} /> Back to Inventory
      </Link>
      <MaterialDetail
        material={material}
        onHand={onHand}
        tab={tab}
        batches={batches}
        movements={movements}
      />
    </div>
  );
}
