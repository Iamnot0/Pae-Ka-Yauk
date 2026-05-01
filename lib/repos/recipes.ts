/**
 * Recipe data access. One active recipe per SellableItem at a time.
 *
 * Versioning: when the recipe changes, create a NEW Recipe row (with
 * version = prior + 1), mark the old one's activeTo = now. Past SaleLines
 * reference the Recipe row they consumed via recipeVersion — so changing
 * the recipe today never mutates yesterday's reports.
 *
 * For the first sell demo we use simple overwrite semantics: one recipe per
 * item, replace-in-place. Versioning wiring ships alongside the POS.
 */

import { sql } from '@/lib/neonHttp';
import type { Unit } from '@/lib/repos/materials';

function toCuid(): string {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
  let s = 'c';
  for (let i = 0; i < 24; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RecipeIngredient {
  id: string;
  recipeId: string;
  materialId: string;
  quantity: number;
  unit: Unit;
  note: string | null;
  sortOrder: number;

  // joined fields for display
  materialName?: string;
  materialBaseUnit?: Unit;
}

export interface Recipe {
  id: string;
  tenantId: string;
  itemId: string;
  version: number;
  activeFrom: string;
  activeTo: string | null;
  yield: number;
  yieldUnit: Unit;
  wasteFactor: number;
  notes: string | null;
  ingredients: RecipeIngredient[];
}

export interface UpsertIngredientInput {
  materialId: string;
  quantity: number;
  unit: Unit;
  note?: string | null;
  sortOrder?: number;
}

export interface UpsertRecipeInput {
  itemId: string;
  yield: number;
  yieldUnit: Unit;
  wasteFactor?: number;
  notes?: string | null;
  ingredients: UpsertIngredientInput[];
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Return the currently active recipe for an item (null if none). */
export async function getActiveRecipe(
  tenantId: string,
  itemId: string
): Promise<Recipe | null> {
  const rows = (await sql(
    `SELECT id, "tenantId", "itemId", version,
            "activeFrom"::text AS "activeFrom",
            "activeTo"::text   AS "activeTo",
            yield::float8       AS yield,
            "yieldUnit",
            "wasteFactor"::float8 AS "wasteFactor",
            notes
     FROM recipes
     WHERE "tenantId" = $1 AND "itemId" = $2 AND "activeTo" IS NULL
     ORDER BY version DESC
     LIMIT 1`,
    [tenantId, itemId]
  )) as Recipe[];
  const recipe = rows[0];
  if (!recipe) return null;

  const ings = (await sql(
    `SELECT ri.id, ri."recipeId", ri."materialId",
            ri.quantity::float8 AS quantity,
            ri.unit, ri.note, ri."sortOrder",
            rm.name      AS "materialName",
            rm."baseUnit" AS "materialBaseUnit"
     FROM recipe_ingredients ri
     JOIN raw_materials rm ON rm.id = ri."materialId"
     WHERE ri."recipeId" = $1
     ORDER BY ri."sortOrder" ASC, ri.id ASC`,
    [recipe.id]
  )) as RecipeIngredient[];

  return { ...recipe, ingredients: ings };
}

/** Bulk lookup for BOM engine: itemIds → active recipes. */
export async function getActiveRecipesForItems(
  tenantId: string,
  itemIds: string[]
): Promise<Record<string, Recipe>> {
  if (itemIds.length === 0) return {};
  const recipes = (await sql(
    `SELECT DISTINCT ON ("itemId")
            id, "tenantId", "itemId", version,
            "activeFrom"::text AS "activeFrom",
            "activeTo"::text   AS "activeTo",
            yield::float8       AS yield,
            "yieldUnit",
            "wasteFactor"::float8 AS "wasteFactor",
            notes
     FROM recipes
     WHERE "tenantId" = $1 AND "itemId" = ANY($2::text[]) AND "activeTo" IS NULL
     ORDER BY "itemId", version DESC`,
    [tenantId, itemIds]
  )) as Recipe[];

  if (recipes.length === 0) return {};
  const recipeIds = recipes.map((r) => r.id);
  const ings = (await sql(
    `SELECT ri.id, ri."recipeId", ri."materialId",
            ri.quantity::float8 AS quantity,
            ri.unit, ri.note, ri."sortOrder",
            rm.name       AS "materialName",
            rm."baseUnit" AS "materialBaseUnit"
     FROM recipe_ingredients ri
     JOIN raw_materials rm ON rm.id = ri."materialId"
     WHERE ri."recipeId" = ANY($1::text[])
     ORDER BY ri."sortOrder" ASC`,
    [recipeIds]
  )) as RecipeIngredient[];

  const ingsByRecipe: Record<string, RecipeIngredient[]> = {};
  for (const ing of ings) {
    (ingsByRecipe[ing.recipeId] ??= []).push(ing);
  }
  const byItem: Record<string, Recipe> = {};
  for (const r of recipes) {
    byItem[r.itemId] = { ...r, ingredients: ingsByRecipe[r.id] ?? [] };
  }
  return byItem;
}

/**
 * Create or version-bump a recipe for an item.
 *
 * Versioning semantics (changed 2026-04-28 — used to delete + re-insert):
 *   - Find the current active recipe (activeTo IS NULL) for this item.
 *   - If one exists, stamp `activeTo = NOW()` so it becomes a historical
 *     row that past sale_lines / production_batches can still cost against
 *     via their stored `recipeVersion`. The old recipe's ingredients stay
 *     attached to the now-archived row — they're not deleted.
 *   - Insert a fresh row with `version = (previous max version) + 1`,
 *     `activeFrom = NOW()`, `activeTo = NULL`.
 *   - First-time create → version = 1.
 *
 * Why this matters: a sale rung six months ago against recipe v1 should
 * still report the right COGS even after the owner edits the recipe today.
 * Same for /production batches — historical bakes reference v1, current
 * bakes reference v2.
 */
export async function upsertRecipe(
  tenantId: string,
  input: UpsertRecipeInput
): Promise<Recipe> {
  if (input.ingredients.length === 0) throw new Error('Recipe must have at least one ingredient');
  if (input.yield <= 0) throw new Error('Recipe yield must be positive');

  // Archive any active recipe for this item (preserves history).
  await sql(
    `UPDATE recipes
        SET "activeTo" = NOW(), "updatedAt" = NOW()
      WHERE "tenantId" = $1 AND "itemId" = $2 AND "activeTo" IS NULL`,
    [tenantId, input.itemId]
  );

  // Compute the next version number — MAX over all rows for this item, +1.
  const versionRows = (await sql(
    `SELECT COALESCE(MAX(version), 0) + 1 AS next
       FROM recipes
      WHERE "tenantId" = $1 AND "itemId" = $2`,
    [tenantId, input.itemId]
  )) as Array<{ next: number }>;
  const nextVersion = versionRows[0]?.next ?? 1;

  const recipeId = toCuid();
  await sql(
    `INSERT INTO recipes (
       id, "tenantId", "itemId", version, "activeFrom", "activeTo",
       yield, "yieldUnit", "wasteFactor", notes,
       "createdAt", "updatedAt"
     ) VALUES ($1, $2, $3, $4, NOW(), NULL, $5, $6, $7, $8, NOW(), NOW())`,
    [
      recipeId, tenantId, input.itemId, nextVersion,
      input.yield, input.yieldUnit,
      input.wasteFactor ?? 0, input.notes ?? null,
    ]
  );

  // Insert ingredients sequentially (small N, keeps things simple)
  for (let i = 0; i < input.ingredients.length; i++) {
    const ing = input.ingredients[i];
    await sql(
      `INSERT INTO recipe_ingredients (
         id, "recipeId", "materialId", "subRecipeId",
         quantity, unit, note, "sortOrder"
       ) VALUES ($1, $2, $3, NULL, $4, $5, $6, $7)`,
      [
        toCuid(), recipeId, ing.materialId,
        ing.quantity, ing.unit, ing.note ?? null, ing.sortOrder ?? i,
      ]
    );
  }

  const out = await getActiveRecipe(tenantId, input.itemId);
  if (!out) throw new Error('Recipe upsert succeeded but fetch returned nothing');
  return out;
}

/**
 * Archive the active recipe for an item (changed 2026-04-28 from hard
 * delete). Sets `activeTo = NOW()` so past sale_lines and production_batches
 * can still resolve their recipeVersion. After this call, getActiveRecipe()
 * returns null for the item — the owner can re-create one to start v(N+1).
 */
export async function deleteActiveRecipe(tenantId: string, itemId: string): Promise<void> {
  await sql(
    `UPDATE recipes
        SET "activeTo" = NOW(), "updatedAt" = NOW()
      WHERE "tenantId" = $1 AND "itemId" = $2 AND "activeTo" IS NULL`,
    [tenantId, itemId]
  );
}
