/**
 * BOM (bill-of-materials) deduction engine — pure function, no I/O.
 *
 * Given:
 *   - what was sold (line items with qty)
 *   - the recipe for each item (ingredients + units)
 *   - the base unit of each material (for conversion into ledger units)
 *
 * Returns:
 *   - a list of Deduction entries: one per material, qty in the material's baseUnit
 *
 * Why pure:
 *   Deterministic, unit-testable with golden numbers, and the same function
 *   runs identically for live sales (POS) AND retroactive replay (reports
 *   that need to recompute "theoretical usage for last month").
 *
 * Not handled yet (Sprint 4+):
 *   - modifier ingredient deltas (Large +8g beans)
 *   - sub-recipes (Sweet Bun Dough used across variants)
 *   - yield / waste factor (1 batch bread → 0.85 kg baked)
 */

import type { Unit } from '@/lib/repos/materials';
import { convert } from './convert';

// ---------------------------------------------------------------------------
// Input shapes
// ---------------------------------------------------------------------------

export interface SaleLineForBom {
  itemId: string;
  qty: number;                  // how many of this item the customer bought
}

export interface RecipeIngredientForBom {
  materialId: string;
  quantity: number;             // per recipe (see Recipe.yield for units-produced)
  unit: Unit;                   // unit of THIS quantity — may differ from material.baseUnit
}

export interface RecipeForBom {
  itemId: string;
  yield: number;                // how many units one batch of this recipe produces
  yieldUnit: Unit;              // typically PCS for drinks/bakery
  ingredients: RecipeIngredientForBom[];
}

export interface MaterialBaseUnit {
  materialId: string;
  baseUnit: Unit;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface Deduction {
  materialId: string;
  qty: number;                  // always positive; sign applied at ledger write time
  unit: Unit;                   // always material.baseUnit
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/**
 * Compute total ingredient deductions for a set of sold lines.
 *
 * Algorithm:
 *   for each sold line:
 *     recipe = recipeByItem[line.itemId]   (skip if no recipe)
 *     scale = line.qty / recipe.yield      (how many recipes' worth)
 *     for each ingredient:
 *       qtyInRecipeUnit   = ingredient.quantity × scale
 *       qtyInMaterialBase = convert(qtyInRecipeUnit, ingredient.unit → material.baseUnit)
 *       accumulate into deductionMap[materialId]
 *
 * Items without a recipe are silently skipped — the caller decides whether
 * that's OK (retail merch, pass-through items) or an error.
 */
export function computeDeductions(
  soldLines: SaleLineForBom[],
  recipesByItemId: Record<string, RecipeForBom>,
  materialBaseUnits: Record<string, Unit>
): Deduction[] {
  const acc = new Map<string, number>();   // materialId → qty in baseUnit

  for (const line of soldLines) {
    const recipe = recipesByItemId[line.itemId];
    if (!recipe) continue;                 // no recipe = no deduction (merch/pass-through)

    const scale = line.qty / recipe.yield;

    for (const ing of recipe.ingredients) {
      const baseUnit = materialBaseUnits[ing.materialId];
      if (!baseUnit) {
        throw new Error(`Missing baseUnit for material ${ing.materialId} (recipe for item ${recipe.itemId})`);
      }
      const recipeQty = ing.quantity * scale;
      const deductQty = convert(recipeQty, ing.unit, baseUnit);
      acc.set(ing.materialId, (acc.get(ing.materialId) ?? 0) + deductQty);
    }
  }

  const out: Deduction[] = [];
  for (const [materialId, qty] of acc) {
    if (qty <= 0) continue;                // defensive — shouldn't happen
    out.push({ materialId, qty, unit: materialBaseUnits[materialId] });
  }
  return out;
}
