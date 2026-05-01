import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/neonHttp';
import { getActiveRecipesForItems } from '@/lib/repos/recipes';
import { ProductionScreen } from '@/components/production/ProductionScreen';

interface BatchItemRow {
  id: string;
  name: string;
  nameLocal: string | null;
  category: string;
  finishedGoodsOnHand: number;
}

export default async function ProductionPage() {
  const user = await requireUser();
  const items = (await sql(
    `SELECT id, name, "nameLocal", category,
            "finishedGoodsOnHand"::float8 AS "finishedGoodsOnHand"
     FROM sellable_items
     WHERE "tenantId" = $1 AND "deletedAt" IS NULL AND active = true
       AND "productionMode" = 'BATCH'
     ORDER BY name ASC`,
    [user.tenantId]
  )) as BatchItemRow[];

  const recipes = await getActiveRecipesForItems(
    user.tenantId,
    items.map((i) => i.id)
  );

  return <ProductionScreen items={items} recipes={recipes} />;
}
