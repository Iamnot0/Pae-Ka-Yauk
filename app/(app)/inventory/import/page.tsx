import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { ImportWizard } from '@/components/inventory/ImportWizard';

export default async function ImportMaterialsPage() {
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
        <h1 style={{ marginBottom: 4 }}>Import Raw Materials</h1>
        <p style={{ color: 'var(--color-muted-fg)', margin: 0 }}>
          <span lang="my" className="text-myanmar">ကုန်ကြမ်းများ Excel/CSV မှ သွင်းမည်</span>
        </p>
      </header>
      <ImportWizard />
    </div>
  );
}
