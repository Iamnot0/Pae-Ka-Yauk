import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { MaterialForm } from '@/components/inventory/MaterialForm';

export default async function NewMaterialPage() {
  await requireUser();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <Link
        href="/inventory"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 'var(--space-1)',
          color: 'var(--color-muted-fg)',
          textDecoration: 'none',
          fontSize: '0.9375rem',
          width: 'fit-content',
        }}
      >
        <ChevronLeft size={16} /> Back to Inventory
      </Link>
      <header>
        <h1 style={{ marginBottom: 4 }}>Add Raw Material</h1>
        <p style={{ color: 'var(--color-muted-fg)', margin: 0 }}>
          <span lang="my" className="text-myanmar">ကုန်ကြမ်းအသစ်ထည့်ရန်</span>
        </p>
      </header>
      <MaterialForm mode="create" />
    </div>
  );
}
