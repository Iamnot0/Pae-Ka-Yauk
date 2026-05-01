/**
 * Display-category mapping for sellable items.
 *
 * The DB enum (`ItemCategory`) keeps fine-grained values for accounting:
 *   COFFEE_HOT, COFFEE_COLD, TEA, COLD_DRINK …
 *
 * The customer-facing UI rolls those up into operational groups so a single
 * "Hot Drink" filter / chip / report bucket spans coffee AND tea. Same for
 * "Cold Drink" spanning iced coffee + cold drinks.
 *
 * One helper used by Stocks filter, Reports by-category, PDF generator,
 * and the POS chip row keeps every surface in lockstep.
 */

import type { ItemCategory } from '@/lib/repos/items';
import type { DictKey } from '@/lib/i18n/dict';

/**
 * The display-level category set. Order matters — drives the Stocks filter
 * dropdown order + the chip row order on POS.
 */
export type DisplayCategory =
  | 'BREAD'
  | 'CAKE'
  | 'COOKIES'
  | 'PASTRY'
  | 'SAVORY'
  | 'HOT_DRINK'   // COFFEE_HOT + TEA
  | 'COLD_DRINK'  // COLD_DRINK + COFFEE_COLD
  | 'DESSERT'
  | 'OTHER';

export const DISPLAY_CATEGORY_ORDER: DisplayCategory[] = [
  'BREAD', 'CAKE', 'COOKIES', 'PASTRY', 'SAVORY',
  'HOT_DRINK', 'COLD_DRINK', 'DESSERT', 'OTHER',
];

/** Map a raw enum value → its display bucket. Total — every enum has a home. */
export function toDisplayCategory(raw: ItemCategory): DisplayCategory {
  switch (raw) {
    case 'BAKERY_BREAD':   return 'BREAD';
    case 'BAKERY_CAKE':    return 'CAKE';
    case 'BAKERY_COOKIES': return 'COOKIES';
    case 'BAKERY_PASTRY':  return 'PASTRY';
    case 'BAKERY_SAVORY':  return 'SAVORY';
    case 'COFFEE_HOT':
    case 'TEA':            return 'HOT_DRINK';
    case 'COFFEE_COLD':
    case 'COLD_DRINK':     return 'COLD_DRINK';
    case 'DESSERT':        return 'DESSERT';
    case 'OTHER':          return 'OTHER';
    default: {
      // Exhaustiveness — TS will flag any new ItemCategory not handled above.
      const _exhaustive: never = raw;
      void _exhaustive;
      return 'OTHER';
    }
  }
}

/**
 * Reverse mapping — when a display filter is selected, which raw enum
 * values does it match? Used by Stocks + POS to filter their item arrays.
 */
export function rawCategoriesFor(d: DisplayCategory): ItemCategory[] {
  switch (d) {
    case 'BREAD':      return ['BAKERY_BREAD'];
    case 'CAKE':       return ['BAKERY_CAKE'];
    case 'COOKIES':    return ['BAKERY_COOKIES'];
    case 'PASTRY':     return ['BAKERY_PASTRY'];
    case 'SAVORY':     return ['BAKERY_SAVORY'];
    case 'HOT_DRINK':  return ['COFFEE_HOT', 'TEA'];
    case 'COLD_DRINK': return ['COLD_DRINK', 'COFFEE_COLD'];
    // Dessert is the operational super-bucket — picking it shows EVERY
    // baked item (bread, cake, cookies, pastry, savory) plus the literal
    // DESSERT enum (puddings, ice cream, eclairs, etc.). Mirrors the POS
    // quick-filter chip behaviour: "Dessert ⊃ Cake + Bread + Pastry".
    case 'DESSERT':    return [
      'DESSERT',
      'BAKERY_BREAD', 'BAKERY_CAKE', 'BAKERY_COOKIES',
      'BAKERY_PASTRY', 'BAKERY_SAVORY',
    ];
    case 'OTHER':      return ['OTHER'];
  }
}

/** i18n dict key for a display category — drives bilingual rendering. */
export function displayCategoryDictKey(d: DisplayCategory): DictKey {
  switch (d) {
    case 'BREAD':      return 'cat.bread';
    case 'CAKE':       return 'cat.cake';
    case 'COOKIES':    return 'cat.cookies';
    case 'PASTRY':     return 'cat.pastry';
    case 'SAVORY':     return 'cat.savory';
    case 'HOT_DRINK':  return 'cat.hotDrink';
    case 'COLD_DRINK': return 'cat.coldDrink';
    case 'DESSERT':    return 'cat.dessert';
    case 'OTHER':      return 'cat.other';
  }
}

/** Plain-English label for non-i18n contexts (PDF, server logs). */
export function displayCategoryLabelEn(d: DisplayCategory): string {
  switch (d) {
    case 'BREAD':      return 'Bread';
    case 'CAKE':       return 'Cake';
    case 'COOKIES':    return 'Cookies';
    case 'PASTRY':     return 'Pastry';
    case 'SAVORY':     return 'Savory';
    case 'HOT_DRINK':  return 'Hot Drink';
    case 'COLD_DRINK': return 'Cold Drink';
    case 'DESSERT':    return 'Dessert';
    case 'OTHER':      return 'Other';
  }
}
