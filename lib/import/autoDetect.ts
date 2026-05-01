/**
 * Smart auto-detection for the import wizard.
 *
 * Given a parsed xlsx/csv, it infers:
 *   - Column mapping (which header is name, code, price, expiry, etc.)
 *   - Per-row category from the material name (keyword classifier)
 *   - Per-row storage zone + tracking mode + base unit (from category defaults
 *     and/or value strings like "500g", "12 pcs")
 *   - Replenish-only flag for colors/flavors/packaging (not deducted by recipes)
 *
 * Zero manual mapping needed when headers are reasonable.
 * Returns a `confidence` score — low confidence falls back to manual map step.
 */

import type { ParseResult } from './parse';
import type {
  MaterialCategory,
  StorageZone,
  Unit,
  TrackingMode,
  CreateMaterialInput,
} from '@/lib/repos/materials';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DetectedColumns {
  name?: string;
  nameLocal?: string;
  code?: string;
  category?: string;
  storageZone?: string;
  baseUnit?: string;
  parLevel?: string;
  lastUnitCost?: string;
  notes?: string;
}

export interface DetectedRow extends CreateMaterialInput {
  errors: string[];
  _inferred: { category: boolean; storageZone: boolean; baseUnit: boolean };
}

export interface DetectionResult {
  columns: DetectedColumns;
  rows: DetectedRow[];
  confidence: number; // 0..1
  summary: {
    total: number;
    valid: number;
    byCategory: Array<{ category: MaterialCategory; count: number }>;
  };
}

// ---------------------------------------------------------------------------
// Header patterns — ordered, first match wins per field
// ---------------------------------------------------------------------------

type HeaderPattern = { field: keyof DetectedColumns; patterns: RegExp[] };

const HEADER_PATTERNS: HeaderPattern[] = [
  {
    field: 'name',
    patterns: [
      /^name\b/i, /^item(\s*name)?$/i, /^stock(\s*name)?$/i, /^product(\s*name)?$/i,
      /^material(\s*name)?$/i, /raw\s*material(\s*name)?/i, /\bname$/i,
      /^description$/i, /^ingredient(\s*name)?$/i, /အမည်/, /ပစ္စည်း/,
    ],
  },
  {
    field: 'nameLocal',
    patterns: [
      /myanmar/i, /burmese/i, /local(\s*name)?/i, /မြန်မာ/,
    ],
  },
  {
    field: 'code',
    patterns: [/^code$/i, /^abbr\w*/i, /^sku$/i, /^id$/i, /^ref$/i],
  },
  {
    field: 'category',
    patterns: [/^categor/i, /^type$/i, /^group$/i, /အမျိုးအစား/],
  },
  {
    field: 'storageZone',
    patterns: [/^zone$/i, /^storage/i, /^location/i, /သိုလှောင်/],
  },
  {
    field: 'baseUnit',
    patterns: [/^unit$/i, /^uom$/i, /^measure/i, /ယူနစ်/],
  },
  {
    field: 'parLevel',
    patterns: [
      /^par/i, /^min(imum)?$/i, /^reorder/i, /^threshold/i,
      /^qty$/i, /^quantity$/i, /^count$/i, /^stock\s*level/i,
      /^weight$/i, /^wt\.?$/i, /^pack(\s*size)?$/i, /^size$/i, /^net\s*wt/i,
      /ပမာဏ/, /အလေးချိန်/,
    ],
  },
  {
    field: 'lastUnitCost',
    patterns: [
      /^price$/i, /^cost$/i, /^rate$/i, /^unit\s*cost/i, /^last\s*cost/i,
      /^buy\s*price/i, /^purchase\s*price/i, /စျေးနှုန်း/,
    ],
  },
  {
    field: 'notes',
    patterns: [/^note/i, /^remark/i, /^comment/i, /^description$/i, /မှတ်ချက်/],
  },
];

function detectColumns(headers: string[]): DetectedColumns {
  const detected: DetectedColumns = {};
  const used = new Set<string>();

  for (const { field, patterns } of HEADER_PATTERNS) {
    for (const header of headers) {
      if (used.has(header)) continue;
      if (patterns.some((p) => p.test(header))) {
        detected[field] = header;
        used.add(header);
        break;
      }
    }
  }

  return detected;
}

// ---------------------------------------------------------------------------
// Value parsers
// ---------------------------------------------------------------------------

const UNIT_ALIASES: Record<string, Unit> = {
  g: 'G', gr: 'G', gm: 'G', gms: 'G', gram: 'G', grams: 'G', grm: 'G',
  kg: 'KG', kgs: 'KG', kilo: 'KG', kilos: 'KG', kilogram: 'KG', kilograms: 'KG',
  // viss = Myanmar weight unit (≈1.633kg). Map to KG; exact conversion handled elsewhere.
  viss: 'KG', peitha: 'KG', 'peit-tha': 'KG',
  ml: 'ML', mls: 'ML', milliliter: 'ML', millilitre: 'ML',
  // cc ≈ ml volumetrically — common in Myanmar food labels
  cc: 'ML', ccs: 'ML',
  l: 'L', lt: 'L', lit: 'L', ltr: 'L', liter: 'L', litre: 'L', liters: 'L', litres: 'L',
  pc: 'PCS', pcs: 'PCS', pice: 'PCS', piece: 'PCS', pieces: 'PCS',
  ea: 'PCS', each: 'PCS', unit: 'PCS', units: 'PCS',
  nos: 'PCS', no: 'PCS', num: 'PCS', slice: 'PCS', slices: 'PCS',
  box: 'BOX', boxes: 'BOX', bx: 'BOX',
  pk: 'PACK', pkt: 'PACK', pack: 'PACK', packs: 'PACK', packet: 'PACK', packets: 'PACK',
  ctn: 'CARTON', carton: 'CARTON', cartons: 'CARTON',
  btl: 'BOTTLE', bottle: 'BOTTLE', bottles: 'BOTTLE',
  can: 'CAN', cans: 'CAN', tin: 'CAN', tins: 'CAN',
};

/** "500g" / "2 kg" / "12 pcs" / "24 bottles" → { qty, unit } */
export function parseQtyUnit(raw: string | null | undefined): { qty: number | null; unit: Unit | null } {
  if (!raw) return { qty: null, unit: null };
  const s = String(raw).trim().toLowerCase();
  if (!s) return { qty: null, unit: null };

  // Plain number
  const pureNum = Number(s.replace(/,/g, ''));
  if (Number.isFinite(pureNum)) return { qty: pureNum, unit: null };

  // Number + unit (e.g., "500g", "2 kg", "12pcs")
  const m = s.match(/^\s*([\d.,]+)\s*([a-z]+)\s*$/i);
  if (m) {
    const qty = Number(m[1].replace(/,/g, ''));
    const unit = UNIT_ALIASES[m[2].toLowerCase()] ?? null;
    if (Number.isFinite(qty)) return { qty, unit };
  }

  return { qty: null, unit: null };
}

/** Parse a unit-only string like "KG", "grams", "pcs". */
export function parseUnitOnly(raw: string | null | undefined): Unit | null {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  return UNIT_ALIASES[s] ?? null;
}

/** Parse money-ish cell: "2,500", "2500 MMK", "MMK 2500", "2500.50" → number | null */
export function parseMoney(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = String(raw).replace(/mmk|ကျပ်|ks|kyat/gi, '').replace(/[,\s$]/g, '').trim();
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const ZONE_KEYWORDS: Array<{ zone: StorageZone; patterns: RegExp[] }> = [
  { zone: 'COLD',     patterns: [/^cold/i, /fridge/i, /freezer/i, /chill/i, /refriger/i, /အအေး/] },
  { zone: 'DRY',      patterns: [/^dry/i, /ambient/i, /shelf/i, /pantry/i, /ခြောက်/] },
  { zone: 'SUPPLIES', patterns: [/supply/i, /supplies/i, /packaging/i, /non[-\s]?food/i, /ထောက်ပံ့/] },
];

export function parseZone(raw: string | null | undefined): StorageZone | null {
  if (!raw) return null;
  const s = String(raw).trim();
  for (const { zone, patterns } of ZONE_KEYWORDS) {
    if (patterns.some((p) => p.test(s))) return zone;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Category classifier — keyword-based, priority-ordered.
// First match wins, so put MORE-SPECIFIC signals earlier.
// ---------------------------------------------------------------------------

interface CategoryRule {
  match: RegExp;
  category: MaterialCategory;
  defaults: Partial<CreateMaterialInput>;
}

const CATEGORY_RULES: CategoryRule[] = [
  // ── COLOR / FLAVOR — replenish-only (not deducted by recipes) ───
  {
    match: /\b(flav(o|ou)r|colou?r|winner|unicorn)\b/i,
    category: 'COLOR_FLAVOR',
    defaults: { storageZone: 'DRY', trackBy: 'COUNT', baseUnit: 'BOTTLE', replenishOnly: true },
  },

  // ── PACKAGING — replenish-only ───
  {
    match: /\b(plastic|packing|packag|tape|cup|lid|bag|straw|napkin|wrap|tric|pudding cup)\b/i,
    category: 'PACKAGING',
    defaults: { storageZone: 'SUPPLIES', trackBy: 'COUNT', baseUnit: 'PCS', replenishOnly: true },
  },

  // ── BEVERAGE BASE ───
  {
    match: /\b(coffee|nescafe|espresso|latte|mocha|tea\b|tea leaf|syrup|creamer)\b/i,
    category: 'BEVERAGE_BASE',
    defaults: { storageZone: 'DRY', trackBy: 'WEIGHT', baseUnit: 'G' },
  },

  // ── DAIRY — includes eggs, specific milk/cream/cheese variants ───
  {
    match: /\b(milk|cheese|cheddar|egg|evaporated|condensed|whipping|topping cream|cream cheese|slice cheese|kaya)\b/i,
    category: 'DAIRY',
    defaults: { storageZone: 'COLD', trackBy: 'WEIGHT', baseUnit: 'ML', tracksExpiry: true, enforceFifo: true },
  },

  // ── FAT / OIL ───
  {
    match: /\b(oil|margarine|shortening|butter oil|vegetable oil|butter\b(?! flav))/i,
    category: 'FAT_OIL',
    defaults: { storageZone: 'DRY', trackBy: 'WEIGHT', baseUnit: 'L' },
  },

  // ── SWEETENER ───
  {
    match: /\b(sugar|icing|sweetener|glucose)\b/i,
    category: 'SWEETENER',
    defaults: { storageZone: 'DRY', trackBy: 'WEIGHT', baseUnit: 'KG' },
  },

  // ── FLOUR & LEAVENING — careful: "milk powder" should NOT match "powder" here ───
  {
    match: /\b(bread flour|cake flour|corn flour|plain flour|self[- ]rais|flour|yeast|bread improver|baking powder|baking soda|agar|pudding powder|vanilla powder|\bsp\b)\b/i,
    category: 'FLOUR_LEAVENING',
    defaults: { storageZone: 'DRY', trackBy: 'WEIGHT', baseUnit: 'KG' },
  },

  // ── FRUIT / FILLING ───
  {
    match: /\b(jam|paste|filling|fruit|cherry|blueberry|strawberry|pineapple|raisin|mix fruit|coconut|coconut cream|coconut milk|coconut powder|pandan|durian|red bean|queen|custard|coating)\b/i,
    category: 'FRUIT_FILLING',
    defaults: { storageZone: 'DRY', trackBy: 'WEIGHT', baseUnit: 'G' },
  },

  // ── CHOCOLATE / NUT ───
  {
    match: /\b(chocolate|choc|cocoa|cashew|nut|almond|walnut|peanut|pistachio|oreo|biscuit)\b/i,
    category: 'CHOCOLATE_NUT',
    defaults: { storageZone: 'DRY', trackBy: 'WEIGHT', baseUnit: 'G' },
  },

  // ── PROTEIN / SAVORY ───
  {
    match: /\b(chicken|sausage|ham|floss|burger|pork|beef|bacon|meat)\b/i,
    category: 'PROTEIN_SAVORY',
    defaults: { storageZone: 'COLD', trackBy: 'WEIGHT', baseUnit: 'G', tracksExpiry: true, enforceFifo: true },
  },

  // ── SAUCE / SEASONING ───
  {
    match: /\b(sauce|ketchup|mayonaise|mayonnaise|mayo|chilli|chili|garlic|onion|pepper|salt|scallion|tar\s*tar|vinegar|soy)\b/i,
    category: 'SAUCE_SEASONING',
    defaults: { storageZone: 'DRY', trackBy: 'WEIGHT', baseUnit: 'ML' },
  },
];

export function classifyByName(name: string): { category: MaterialCategory; defaults: Partial<CreateMaterialInput> } {
  const s = name.trim();
  if (!s) return { category: 'OTHER', defaults: { storageZone: 'DRY', trackBy: 'WEIGHT', baseUnit: 'G' } };

  for (const rule of CATEGORY_RULES) {
    if (rule.match.test(s)) return { category: rule.category, defaults: rule.defaults };
  }
  return { category: 'OTHER', defaults: { storageZone: 'DRY', trackBy: 'WEIGHT', baseUnit: 'G' } };
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

function parseEnum<T extends string>(raw: string | undefined, values: readonly T[]): T | null {
  if (!raw) return null;
  const s = raw.trim().toUpperCase().replace(/\s+/g, '_');
  return (values as readonly string[]).includes(s) ? (s as T) : null;
}

const CATEGORY_VALUES = [
  'FLOUR_LEAVENING', 'FAT_OIL', 'DAIRY', 'SWEETENER', 'FRUIT_FILLING',
  'CHOCOLATE_NUT', 'PROTEIN_SAVORY', 'SAUCE_SEASONING', 'COLOR_FLAVOR',
  'BEVERAGE_BASE', 'PACKAGING', 'OTHER',
] as const;
const ZONE_VALUES = ['COLD', 'DRY', 'SUPPLIES'] as const;

export function autoDetect(parsed: ParseResult): DetectionResult {
  const columns = detectColumns(parsed.headers);

  const rows: DetectedRow[] = [];
  const seen = new Set<string>();
  const catCounts = new Map<MaterialCategory, number>();

  for (const raw of parsed.rows) {
    const pick = (col?: string) => (col ? (raw[col] ?? '').trim() : '');

    const name = pick(columns.name);
    const nameLocal = pick(columns.nameLocal) || null;
    const code = pick(columns.code) || null;
    const notes = pick(columns.notes) || null;

    // Category — prefer explicit column, fall back to classifier on name
    const explicitCat = parseEnum(pick(columns.category), CATEGORY_VALUES);
    const { category: inferredCat, defaults: catDefaults } = classifyByName(name);
    const category = explicitCat ?? inferredCat;
    const categoryInferred = !explicitCat;

    // Zone — explicit column → parsed zone string → category default → DRY
    const explicitZone = parseZone(pick(columns.storageZone));
    const storageZone: StorageZone =
      explicitZone ?? (catDefaults.storageZone as StorageZone | undefined) ?? 'DRY';
    const zoneInferred = !explicitZone;

    // Par level + embedded unit (e.g., "500g" → qty 500, unit G)
    const parRaw = pick(columns.parLevel);
    const parsedPar = parseQtyUnit(parRaw);
    const parLevel = parsedPar.qty;

    // Base unit — explicit column → parsed from par level string → category default → G
    const explicitUnit = parseUnitOnly(pick(columns.baseUnit));
    const baseUnit: Unit =
      explicitUnit ?? parsedPar.unit ?? (catDefaults.baseUnit as Unit | undefined) ?? 'G';
    const unitInferred = !explicitUnit && !parsedPar.unit;

    const trackBy: TrackingMode =
      (catDefaults.trackBy as TrackingMode | undefined) ??
      (['PCS', 'BOX', 'PACK', 'CARTON', 'BOTTLE', 'CAN'].includes(baseUnit) ? 'COUNT' : 'WEIGHT');

    const lastUnitCost = parseMoney(pick(columns.lastUnitCost));

    // Validation
    const errors: string[] = [];
    if (!name) errors.push('Name is empty');
    const lower = name.toLowerCase();
    if (name && seen.has(lower)) errors.push('Duplicate within file');
    if (name) seen.add(lower);

    rows.push({
      name,
      nameLocal,
      code,
      category,
      storageZone,
      baseUnit,
      trackBy,
      replenishOnly: catDefaults.replenishOnly ?? false,
      tracksExpiry: catDefaults.tracksExpiry ?? false,
      enforceFifo: catDefaults.enforceFifo ?? false,
      parLevel,
      lastUnitCost,
      notes,
      errors,
      _inferred: { category: categoryInferred, storageZone: zoneInferred, baseUnit: unitInferred },
    });

    catCounts.set(category, (catCounts.get(category) ?? 0) + 1);
  }

  // Confidence — high if we detected a name column
  const confidence = columns.name ? 0.95 : 0.2;

  const byCategory = Array.from(catCounts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  return {
    columns,
    rows,
    confidence,
    summary: {
      total: rows.length,
      valid: rows.filter((r) => r.errors.length === 0).length,
      byCategory,
    },
  };
}
