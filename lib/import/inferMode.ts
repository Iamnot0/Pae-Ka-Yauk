import type { ItemCategory } from '@/lib/repos/items';

const MTO_CATEGORIES = new Set<ItemCategory>([
  'COFFEE_HOT', 'COFFEE_COLD', 'TEA', 'COLD_DRINK',
]);
const MIA_CATEGORIES = new Set<ItemCategory>([
  'BAKERY_BREAD', 'BAKERY_CAKE', 'BAKERY_COOKIES', 'BAKERY_PASTRY', 'BAKERY_SAVORY', 'DESSERT',
]);

const MTO_NAME_RE = /\b(coffee|tea|latte|americano|mocha|espresso|cappuccino|iced|cold|hot|juice|smoothie|lassi|soda|drink|water|milkshake|frappe)\b/i;
const MIA_NAME_RE = /\b(bread|bun|loaf|cake|cookie|biscuit|pastry|croissant|danish|donut|muffin|scone|tart|pie|roll|sandwich|burger)\b/i;

export type ProductionMode = 'DIRECT' | 'BATCH';

/**
 * Infer Make-to-Order vs Made-in-Advance from name + category.
 * Used at xlsx import when the ProductionMode column is absent.
 *
 * Priority:
 *   1. Category (if known) — authoritative
 *   2. Name keyword — fallback
 *   3. BATCH — safe default (finite stock; owner can override)
 */
export function inferProductionMode(
  name: string,
  category?: ItemCategory | null,
): ProductionMode {
  if (category && MTO_CATEGORIES.has(category)) return 'DIRECT';
  if (category && MIA_CATEGORIES.has(category)) return 'BATCH';
  if (MTO_NAME_RE.test(name)) return 'DIRECT';
  if (MIA_NAME_RE.test(name)) return 'BATCH';
  return 'BATCH';
}
