/**
 * POST /api/import/stocks — bulk-create sellable items from a CSV upload.
 *
 * Two ways to call:
 *   1. multipart/form-data with field "file"  → server parses CSV
 *   2. application/json with { rows: [...] }   → for the preview-confirm wizard
 *
 * CSV expected columns (case-insensitive, in any order):
 *   - Name            required, ≤200 chars
 *   - NameLocal       optional, Burmese name
 *   - Category        optional, one of ItemCategory enum (default OTHER)
 *   - Price           optional number (MMK), default 0
 *   - ProductionMode  optional, DIRECT|BATCH (default DIRECT)
 *   - TaxRate         optional 0..1 OR percentage like "5%" (default 0)
 *   - SKU             optional barcode string
 *   - PiecesPerPack   optional integer; pure metadata for pack-sold items
 *                     (e.g. Soft Roll → 6 pcs/pack). Display-only — does
 *                     not affect stock math or recipe yields.
 *
 * Each row is upserted by (tenantId, name). Duplicate names are skipped
 * with a reason in the response. Empty Name rows are silently skipped.
 *
 * Returns: { createdCount, skipped: [{rowIndex, name, reason}], total }
 *
 * GET /api/import/stocks?template=true — returns a CSV template the owner
 * can hand to the supplier or fill in themselves.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/neonHttp';
import { parseCsv, parseXlsx, SHEET_KEY } from '@/lib/import/parse';
import { inferProductionMode } from '@/lib/import/inferMode';
import { createItem, type CreateItemInput, type ItemCategory, type ProductionMode } from '@/lib/repos/items';

export const runtime = 'nodejs';

const CATEGORIES: ItemCategory[] = [
  'BAKERY_BREAD', 'BAKERY_CAKE', 'BAKERY_COOKIES', 'BAKERY_PASTRY', 'BAKERY_SAVORY',
  'COFFEE_HOT', 'COFFEE_COLD', 'TEA', 'COLD_DRINK', 'DESSERT', 'OTHER',
];
const MODES: ProductionMode[] = ['DIRECT', 'BATCH'];

const RowSchema = z.object({
  name: z.string().trim().min(1).max(200),
  nameLocal: z.string().trim().max(200).nullable().optional(),
  category: z.enum(CATEGORIES as unknown as [string, ...string[]]).optional(),
  price: z.number().nonnegative().optional(),
  productionMode: z.enum(MODES as unknown as [string, ...string[]]).optional(),
  taxRate: z.number().min(0).max(1).optional(),
  sku: z.string().trim().max(40).nullable().optional(),
  piecesPerPack: z.number().int().positive().nullable().optional(),
  shelfLifeDays: z.number().int().positive().max(3650).nullable().optional(),
  manualCost: z.number().positive().nullable().optional(),
  onHand: z.number().nonnegative().optional(),
  unit: z.enum([
    'G', 'KG', 'ML', 'L', 'PCS', 'BOX', 'CUP', 'PACK', 'CARTON', 'BOTTLE', 'CAN',
  ]).nullable().optional(),
});

type Skipped = { rowIndex: number; name: string; reason: string };

/** Counters returned to the wizard so it can show how productionMode was chosen. */
type InferredModeStats = {
  inferredDirect: number;
  inferredBatch: number;
  explicit: number;
  defaultedBatch: number;
};

/**
 * Tolerant header lookup — accepts case + space variants AND strips bilingual
 * descriptions in parentheses, so a header like `Name (အမည်)` matches `name`.
 * Also matches by *startsWith* against the normalised header so `Sell price (ရောင်းစျေး)`
 * matches `sellprice`.
 */
function pick(row: Record<string, string>, ...keys: string[]): string {
  const norm = (s: string) =>
    s.toLowerCase().replace(/\(.*?\)/g, '').replace(/[\s_-]+/g, '').trim();

  const idx: Array<{ k: string; v: string }> = [];
  for (const k of Object.keys(row)) {
    if (k === SHEET_KEY) continue;
    idx.push({ k: norm(k), v: row[k] });
  }
  for (const wanted of keys) {
    const w = norm(wanted);
    // Exact normalised match wins.
    const exact = idx.find((e) => e.k === w && e.v !== '');
    if (exact) return exact.v;
    // Then startsWith — owners append units/notes after the column name.
    const starts = idx.find((e) => e.k.startsWith(w) && e.v !== '');
    if (starts) return starts.v;
  }
  return '';
}

/**
 * Map friendly category labels (sheet names + free-text values owners type)
 * to our enum. Order matters: longer/more-specific first so "Cold Drink"
 * lands on COLD_DRINK before any partial match on "cold".
 */
const CATEGORY_ALIASES: Array<[RegExp, ItemCategory]> = [
  // Most-specific first.
  [/cold[\s-]?drink/i,            'COLD_DRINK'],
  [/iced|coffee.*cold/i,          'COFFEE_COLD'],
  [/coffee.*hot/i,                'COFFEE_HOT'],
  // Bare "Cold" / "Hot" cells (Boss's "Hot Cold" sheet uses these per row).
  [/^cold$/i,                     'COFFEE_COLD'],
  [/^hot$/i,                      'COFFEE_HOT'],
  [/tea/i,                        'TEA'],
  [/dessert/i,                    'DESSERT'],
  [/cake/i,                       'BAKERY_CAKE'],
  [/pastry|croissant|danish/i,    'BAKERY_PASTRY'],
  [/bun|bread|loaf|roll/i,        'BAKERY_BREAD'],
  [/savory|savoury|sandwich|burger/i, 'BAKERY_SAVORY'],
  // Sheet-name catch-all — only reached after cell-level matchers fail.
  [/hot[\s-]?cold/i,              'COFFEE_HOT'],
];

function resolveCategory(rawCell: string, sheetName: string): ItemCategory {
  // Direct enum match first (case-insensitive, snake-or-space).
  const normRaw = rawCell.toUpperCase().replace(/[\s-]+/g, '_').trim();
  if (CATEGORIES.includes(normRaw as ItemCategory)) return normRaw as ItemCategory;

  // Try fuzzy match against the cell value, then the sheet name.
  for (const [re, cat] of CATEGORY_ALIASES) {
    if (rawCell && re.test(rawCell)) return cat;
  }
  for (const [re, cat] of CATEGORY_ALIASES) {
    if (sheetName && re.test(sheetName)) return cat;
  }
  return 'OTHER';
}

function parseTax(raw: string): number | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace('%', '').trim();
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return undefined;
  // "5" → 0.05; "0.05" → 0.05
  return n > 1 ? n / 100 : n;
}

function rowsToInputs(rows: Record<string, string>[]): {
  inputs: Array<{ rowIndex: number; data: CreateItemInput; manualCost: number | null }>;
  skipped: Skipped[];
  stats: InferredModeStats;
} {
  const inputs: Array<{ rowIndex: number; data: CreateItemInput; manualCost: number | null }> = [];
  const skipped: Skipped[] = [];
  const stats: InferredModeStats = {
    inferredDirect: 0,
    inferredBatch: 0,
    explicit: 0,
    defaultedBatch: 0,
  };

  // Re-used here to attribute defaultedBatch vs inferredBatch when no explicit
  // ProductionMode column is present. Mirrors the helper's internal rules.
  const MTO_CATS = new Set<ItemCategory>(['COFFEE_HOT', 'COFFEE_COLD', 'TEA', 'COLD_DRINK']);
  const MIA_CATS = new Set<ItemCategory>(['BAKERY_BREAD', 'BAKERY_CAKE', 'BAKERY_COOKIES', 'BAKERY_PASTRY', 'BAKERY_SAVORY', 'DESSERT']);
  const MTO_NAME_RE = /\b(coffee|tea|latte|americano|mocha|espresso|cappuccino|iced|cold|hot|juice|smoothie|lassi|soda|drink|water|milkshake|frappe)\b/i;
  const MIA_NAME_RE = /\b(bread|bun|loaf|cake|cookie|biscuit|pastry|croissant|danish|donut|muffin|scone|tart|pie|roll|sandwich|burger)\b/i;

  rows.forEach((row, i) => {
    const name = pick(row, 'name', 'item', 'product').trim();
    if (!name) return; // silently skip blank rows

    // Local-name column header — accept the common ways an owner might
    // label a Myanmar / bilingual column. The pick() helper already
    // strips bilingual `(...)` suffixes, so `Name (Myanmar)` is NOT a
    // separate column — owners must use a distinct header for the
    // Burmese name (e.g. "Local Name", "Myanmar Name", "Burmese", "MM").
    const nameLocal = pick(
      row,
      'nameLocal', 'name_local', 'name_my', 'name_mm',
      'localName', 'local name', 'local_name',
      'myanmarName', 'myanmar name', 'myanmar', 'myanmar_name',
      'burmeseName', 'burmese name', 'burmese',
      'mm', 'my', 'mmname', 'myname',
    ) || undefined;
    const categoryRawCell = pick(row, 'category', 'type');
    const sheetName = row[SHEET_KEY] ?? '';
    // Resolver tolerates "Bun Item" (→ BAKERY_BREAD), uses sheet name as a
    // fallback ("Bread" / "Cake" / "Hot Cold" tabs).
    const category = resolveCategory(categoryRawCell, sheetName);
    const priceRaw = pick(row, 'price', 'sell price', 'sellprice', 'sellingprice');
    const modeRaw = pick(row, 'productionMode', 'production_mode', 'mode').toUpperCase();
    const taxRaw = pick(row, 'taxRate', 'tax_rate', 'tax');
    const sku = pick(row, 'sku', 'barcode') || undefined;
    // "Pieces Per Pack" / "PiecesPerPack" / "pcs_per_pack" / "qty_per_pack"
    // — owners often write it differently in the spreadsheet, so accept all.
    const ppRaw = pick(row, 'piecesPerPack', 'pieces_per_pack', 'pieces per pack',
                            'pcsperpack', 'pcs_per_pack', 'qty_per_pack',
                            'numberperunit', 'number_per_unit', 'number per unit',
                            'numberofperunit', 'number of per unit', 'number_of_per_unit',
                            'perpack', 'per_pack', 'per pack', 'packsize', 'pack size');
    // Owners write this varied: "6", "6/pack", "6 pcs", "6pcs/pack", "(6)"
    // — extract the first integer found.
    const ppMatch = ppRaw ? ppRaw.match(/\d+/) : null;
    const ppNum = ppMatch ? Math.floor(Number(ppMatch[0])) : null;
    // Per-stock shelf life (days). Owner spreadsheets use varied headers
    // ("Shelf Life", "ShelfLifeDays", "Expire In", "Days").
    const slRaw = pick(row, 'shelfLifeDays', 'shelf_life_days', 'shelf life',
                             'shelflife', 'shelf_life', 'expire_in', 'expirein',
                             'expire days', 'expiredays', 'days');
    const slNum = slRaw ? Math.floor(Number(slRaw.replace(/,/g, ''))) : null;

    // Manual unit cost (Cost column). Strips currency/commas; non-positive → null.
    const manualCostRaw = pick(row, 'cost', 'unitcost', 'unit_cost', 'manualcost', 'manual_cost');
    const parsedManualCost = manualCostRaw ? Number(manualCostRaw.replace(/[^0-9.]/g, '')) : NaN;
    const manualCost = Number.isFinite(parsedManualCost) && parsedManualCost > 0
      ? parsedManualCost
      : null;

    // Opening on-hand quantity. Accepts varied header spellings; non-numeric
    // or negative → 0 (treated as not stocked yet).
    const onHandRaw = pick(row, 'onHand', 'on_hand', 'on hand', 'onhandqty',
                                 'on hand qty', 'on_hand_qty', 'qty', 'quantity',
                                 'stock', 'stockqty', 'stock_qty', 'stock qty',
                                 'finishedGoodsOnHand', 'finished_goods_on_hand');
    const parsedOnHand = onHandRaw ? Number(onHandRaw.replace(/[^0-9.\-]/g, '')) : NaN;
    const onHand = Number.isFinite(parsedOnHand) && parsedOnHand > 0 ? parsedOnHand : 0;

    // Unit of measure. Owners write it varied: "PCS", "Pcs", "pieces", "pc".
    // Uppercase + drop trailing 's' / surrounding spaces, then accept only
    // values present in the Unit enum (G/KG/ML/L/PCS/BOX/CUP/PACK/CARTON/
    // BOTTLE/CAN). Anything else → null.
    const VALID_UNITS = ['G','KG','ML','L','PCS','BOX','CUP','PACK','CARTON','BOTTLE','CAN'];
    const unitRaw = pick(row, 'unit', 'units', 'measure', 'measurement', 'uom');
    const unitNorm = unitRaw
      ? unitRaw.trim().toUpperCase().replace(/\.+$/, '').replace(/\bPIECES?\b/, 'PCS')
      : '';
    const unit = VALID_UNITS.includes(unitNorm) ? unitNorm : null;

    // ProductionMode: explicit cell wins; otherwise infer from category + name.
    // Explicit cell only counts if it's a known mode value.
    const productionModeExplicit = MODES.includes(modeRaw as ProductionMode)
      ? (modeRaw as ProductionMode)
      : null;
    const productionMode: ProductionMode = productionModeExplicit
      ?? inferProductionMode(name, category);

    // Stats attribution for the wizard's import-summary UI.
    if (productionModeExplicit) {
      stats.explicit++;
    } else {
      const fromCategory = !!category && (MTO_CATS.has(category) || MIA_CATS.has(category));
      const fromNameMto = !fromCategory && MTO_NAME_RE.test(name);
      const fromNameMia = !fromCategory && !fromNameMto && MIA_NAME_RE.test(name);
      if (productionMode === 'DIRECT') {
        stats.inferredDirect++;
      } else if (fromCategory || fromNameMia) {
        stats.inferredBatch++;
      } else {
        stats.defaultedBatch++;
      }
    }

    const candidate = {
      name,
      nameLocal: nameLocal ?? null,
      category,
      price: priceRaw ? Number(priceRaw.replace(/,/g, '')) : 0,
      productionMode,
      taxRate: parseTax(taxRaw),
      sku: sku ?? null,
      piecesPerPack: Number.isFinite(ppNum) && ppNum && ppNum > 0 ? ppNum : null,
      shelfLifeDays: Number.isFinite(slNum) && slNum && slNum > 0 ? slNum : null,
      manualCost,
      onHand,
      unit,
    };

    const parsed = RowSchema.safeParse(candidate);
    if (!parsed.success) {
      skipped.push({
        rowIndex: i + 2, // +1 for 0-based, +1 because row 1 is headers
        name,
        reason: parsed.error.issues.map((iss) => iss.message).join('; ').slice(0, 200),
      });
      return;
    }

    inputs.push({
      rowIndex: i + 2,
      manualCost: parsed.data.manualCost ?? null,
      data: {
        sku: parsed.data.sku ?? null,
        name: parsed.data.name,
        nameLocal: parsed.data.nameLocal ?? null,
        category: parsed.data.category as ItemCategory,
        price: parsed.data.price ?? 0,
        productionMode: parsed.data.productionMode as ProductionMode,
        taxRate: parsed.data.taxRate ?? 0,
        piecesPerPack: parsed.data.piecesPerPack ?? null,
        shelfLifeDays: parsed.data.shelfLifeDays ?? null,
        finishedGoodsOnHand: parsed.data.onHand ?? 0,
        unit: parsed.data.unit ?? null,
      },
    });
  });

  return { inputs, skipped, stats };
}

export async function POST(req: Request) {
  const user = await requireUser();
  const ct = req.headers.get('content-type') ?? '';

  let rows: Record<string, string>[] = [];

  if (ct.includes('multipart/form-data')) {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Upload a CSV or XLSX file under field "file"' }, { status: 400 });
    }
    // Branch on extension/MIME — owners drag in either CSV or the XLSX they
    // already maintain in Excel/Google Sheets. ExcelJS handles xlsx; csv stays
    // on the lightweight RFC-4180 parser.
    const name = (file.name || '').toLowerCase();
    const isXlsx =
      name.endsWith('.xlsx') ||
      name.endsWith('.xls') ||
      file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.type === 'application/vnd.ms-excel';
    try {
      if (isXlsx) {
        const buf = Buffer.from(await file.arrayBuffer());
        const parsed = await parseXlsx(buf, file.name);
        rows = parsed.rows;
      } else {
        const text = await file.text();
        const parsed = parseCsv(text, file.name);
        rows = parsed.rows;
      }
    } catch (e) {
      return NextResponse.json(
        { error: `Could not read file: ${(e as Error).message?.slice(0, 200) || 'parse failed'}` },
        { status: 400 },
      );
    }
  } else {
    const body = await req.json().catch(() => null);
    if (!body || !Array.isArray(body.rows)) {
      return NextResponse.json({ error: 'Send rows[] in JSON or upload a CSV file' }, { status: 400 });
    }
    rows = body.rows;
  }

  const { inputs, skipped, stats } = rowsToInputs(rows);

  // Pre-fetch existing names so we can mark duplicates as skipped (instead of
  // tripping the @@unique([tenantId, name]) constraint mid-loop).
  const existing = inputs.length === 0 ? [] : (await sql(
    `SELECT name FROM sellable_items
     WHERE "tenantId" = $1
       AND "deletedAt" IS NULL
       AND name = ANY($2::text[])`,
    [user.tenantId, inputs.map((i) => i.data.name)],
  )) as Array<{ name: string }>;
  const existingSet = new Set(existing.map((r) => r.name));

  const created: string[] = [];
  for (const { rowIndex, data, manualCost } of inputs) {
    if (existingSet.has(data.name)) {
      skipped.push({ rowIndex, name: data.name, reason: 'Already exists' });
      continue;
    }
    try {
      const item = await createItem(user.tenantId, { ...data, manualCost });
      created.push(item.name);
    } catch (e) {
      skipped.push({
        rowIndex,
        name: data.name,
        reason: (e as Error).message?.slice(0, 200) || 'Insert failed',
      });
    }
  }

  return NextResponse.json({
    createdCount: created.length,
    skipped,
    total: rows.length,
    inferredModeStats: stats,
  });
}

export async function GET(req: Request) {
  await requireUser();
  const url = new URL(req.url);
  if (url.searchParams.get('template') !== 'true') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  // CSV template — straight string, no xlsx for this one (Boss asked for CSV)
  const lines = [
    'Name,NameLocal,Category,Price,ProductionMode,TaxRate,SKU,PiecesPerPack,ShelfLifeDays',
    'Soft Roll,ဆော့ဖ်ရိုးလ်,BAKERY_BREAD,3000,BATCH,0.05,,6,3',
    'Latte,လတ်တေး,COFFEE_HOT,3000,DIRECT,0.05,,,',
    'Croissant,ခရိုဆန့်,BAKERY_PASTRY,2500,BATCH,0.05,,,2',
    'Cream Cake,ခရင်မ်ကိတ်,BAKERY_CAKE,5000,BATCH,0.05,,,1',
  ];
  return new NextResponse(lines.join('\n') + '\n', {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="pae-ka-yauk-stocks-template.csv"',
    },
  });
}
