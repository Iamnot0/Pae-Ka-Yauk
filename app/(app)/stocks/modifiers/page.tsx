import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { listModifiers } from '@/lib/repos/modifiers';
import { ModifierManager } from '@/components/modifiers/ModifierManager';

export default async function ModifiersPage() {
  const user = await requireUser();
  const rows = await listModifiers(user.tenantId);
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
        <h1 style={{ marginBottom: 4 }}>Modifiers</h1>
        <p style={{ color: 'var(--color-muted-fg)', margin: 0 }}>
          Size, Milk, Add-on options — each adds a price delta to the base item price.
        </p>
      </header>
      <ModifierManager initial={rows} />
    </div>
  );
}
