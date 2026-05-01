import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { listMaterials } from '@/lib/repos/materials';
import { ReceiveStockForm } from '@/components/inventory/ReceiveStockForm';

export default async function ReceiveStockPage() {
  const user = await requireUser();
  const { rows } = await listMaterials(user.tenantId, { limit: 500 });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', maxWidth: 720, width: '100%' }}>
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
      <ReceiveStockForm materials={rows} />
    </div>
  );
}
