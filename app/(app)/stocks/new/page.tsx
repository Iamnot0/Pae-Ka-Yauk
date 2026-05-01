import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { ItemForm } from '@/components/items/ItemForm';

export default async function NewItemPage() {
  await requireUser();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <Link
        href="/stocks"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)',
          color: 'var(--color-muted-fg)', textDecoration: 'none',
          fontSize: '0.9375rem', width: 'fit-content',
        }}
      >
        <ChevronLeft size={16} /> Back to Items
      </Link>
      <header>
        <h1 style={{ marginBottom: 4 }}>Add Menu Item</h1>
        <p style={{ color: 'var(--color-muted-fg)', margin: 0 }}>
          <span lang="my" className="text-myanmar">မီနူးပစ္စည်းအသစ်ထည့်ရန်</span>
        </p>
      </header>
      <ItemForm mode="create" />
    </div>
  );
}
