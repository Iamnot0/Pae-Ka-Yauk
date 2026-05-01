import { requireUser } from '@/lib/auth';
import { listItems } from '@/lib/repos/items';
import { getActiveRecipesForItems } from '@/lib/repos/recipes';
import { sql } from '@/lib/neonHttp';
import { RecipeList } from '@/components/recipes/RecipeList';
import type { Unit } from '@/lib/repos/materials';

export default async function RecipesPage() {
  const user = await requireUser();

  // Load all active menu items
  const { rows: items } = await listItems(user.tenantId, { limit: 500 });
  const itemIds = items.map((i) => i.id);

  // Load their active recipes
  const recipes = await getActiveRecipesForItems(user.tenantId, itemIds);

  // Load last-purchase cost for every material referenced by any recipe,
  // so we can compute "cost per serving" in one pass without N+1 queries.
  const allMatIds = new Set<string>();
  for (const r of Object.values(recipes)) for (const ing of r.ingredients) allMatIds.add(ing.materialId);

  let matCosts: Record<string, { baseUnit: Unit; lastUnitCost: number | null }> = {};
  if (allMatIds.size > 0) {
    const rows = (await sql(
      `SELECT id, "baseUnit", "lastUnitCost"::float8 AS "lastUnitCost"
       FROM raw_materials WHERE "tenantId" = $1 AND id = ANY($2::text[])`,
      [user.tenantId, [...allMatIds]]
    )) as Array<{ id: string; baseUnit: Unit; lastUnitCost: number | null }>;
    matCosts = Object.fromEntries(rows.map((r) => [r.id, { baseUnit: r.baseUnit, lastUnitCost: r.lastUnitCost }]));
  }

  return <RecipeList items={items} recipes={recipes} matCosts={matCosts} />;
}
