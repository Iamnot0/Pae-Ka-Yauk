import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { readSession } from '@/lib/auth';
import { getItem } from '@/lib/repos/items';
import { ItemForm } from '@/components/items/ItemForm';
import { PrintStickersCard } from '@/components/items/PrintStickersCard';

type Props = { params: Promise<{ id: string }> };

export default async function EditItemPage({ params }: Props) {
  const [session, { id }] = await Promise.all([readSession(), params]);
  if (!session) redirect('/login');

  const item = await getItem(session.tenantId, id);
  if (!item) notFound();

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
        <h1 style={{ marginBottom: 4 }}>Edit: {item.name}</h1>
        {item.nameLocal && (
          <p lang="my" className="text-myanmar" style={{ color: 'var(--color-muted-fg)', margin: 0 }}>
            {item.nameLocal}
          </p>
        )}
      </header>
      <ItemForm mode="edit" initial={item} />
      <PrintStickersCard itemId={item.id} initialSku={item.sku} />
    </div>
  );
}
