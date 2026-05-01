import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { readSession } from '@/lib/auth';
import { getItem } from '@/lib/repos/items';
import { getActiveRecipe } from '@/lib/repos/recipes';
import { listMaterials } from '@/lib/repos/materials';
import { RecipeEditor } from '@/components/recipes/RecipeEditor';

type Props = { params: Promise<{ itemId: string }> };

export default async function EditRecipePage({ params }: Props) {
  const [session, { itemId }] = await Promise.all([readSession(), params]);
  if (!session) redirect('/login');

  const [item, recipe, { rows: materials }] = await Promise.all([
    getItem(session.tenantId, itemId),
    getActiveRecipe(session.tenantId, itemId),
    listMaterials(session.tenantId, { limit: 500 }),
  ]);
  if (!item) notFound();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <Link
        href="/recipes"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)',
          color: 'var(--color-muted-fg)', textDecoration: 'none',
          fontSize: '0.9375rem', width: 'fit-content',
        }}
      >
        <ChevronLeft size={16} /> Back to Recipes
      </Link>
      <RecipeEditor item={item} recipe={recipe} materials={materials} />
    </div>
  );
}
