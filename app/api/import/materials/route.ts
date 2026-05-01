import { NextResponse } from 'next/server';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { requireUser } from '@/lib/auth';
import { bulkCreateMaterials, type CreateMaterialInput } from '@/lib/repos/materials';

const CATEGORIES = [
  'FLOUR_LEAVENING', 'FAT_OIL', 'DAIRY', 'SWEETENER', 'FRUIT_FILLING',
  'CHOCOLATE_NUT', 'PROTEIN_SAVORY', 'SAUCE_SEASONING', 'COLOR_FLAVOR',
  'BEVERAGE_BASE', 'PACKAGING', 'OTHER',
] as const;
const ZONES = ['COLD', 'DRY', 'SUPPLIES'] as const;
const UNITS = ['G', 'KG', 'ML', 'L', 'PCS', 'BOX', 'CUP', 'PACK', 'CARTON', 'BOTTLE', 'CAN'] as const;
const TRACK_BY = ['WEIGHT', 'COUNT'] as const;

const RowSchema = z.object({
  code: z.string().trim().max(20).nullable().optional(),
  name: z.string().trim().min(1).max(200),
  nameLocal: z.string().trim().max(200).nullable().optional(),
  category: z.enum(CATEGORIES),
  storageZone: z.enum(ZONES).optional(),
  baseUnit: z.enum(UNITS),
  trackBy: z.enum(TRACK_BY).optional(),
  replenishOnly: z.boolean().optional(),
  tracksExpiry: z.boolean().optional(),
  enforceFifo: z.boolean().optional(),
  parLevel: z.number().nonnegative().nullable().optional(),
  lastUnitCost: z.number().nonnegative().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const BodySchema = z.object({
  rows: z.array(RowSchema).min(1).max(5000),
});

export async function POST(req: Request) {
  const user = await requireUser();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues.slice(0, 10) },
      { status: 400 }
    );
  }

  const inputs: CreateMaterialInput[] = parsed.data.rows.map((r) => ({
    code: r.code ?? null,
    name: r.name,
    nameLocal: r.nameLocal ?? null,
    category: r.category,
    storageZone: r.storageZone,
    baseUnit: r.baseUnit,
    trackBy: r.trackBy,
    replenishOnly: r.replenishOnly,
    tracksExpiry: r.tracksExpiry,
    enforceFifo: r.enforceFifo,
    parLevel: r.parLevel ?? null,
    lastUnitCost: r.lastUnitCost ?? null,
    notes: r.notes ?? null,
  }));

  try {
    const result = await bulkCreateMaterials(user.tenantId, inputs);
    return NextResponse.json({
      createdCount: result.created.length,
      skipped: result.skipped,
      total: inputs.length,
    });
  } catch (e) {
    console.error('[import/materials POST]', (e as Error).message);
    return NextResponse.json({ error: 'Import failed' }, { status: 500 });
  }
}

/**
 * GET /api/import/materials?template=true
 * Returns a downloadable xlsx template with the expected headers.
 */
export async function GET(req: Request) {
  const user = await requireUser();
  const url = new URL(req.url);
  if (url.searchParams.get('template') !== 'true') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Pae Ka Yauk POS';
  wb.created = new Date();

  const ws = wb.addWorksheet('Raw Materials');

  // Headers
  ws.addRow([
    'Code',
    'Name (English)',
    'Name (Myanmar)',
    'Category',
    'Storage Zone',
    'Base Unit',
    'Par Level',
    'Last Cost (MMK)',
    'Notes',
  ]);
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFFAF7F2' },
  };

  // Column widths
  ws.columns = [
    { width: 10 },  // Code
    { width: 28 },  // Name EN
    { width: 28 },  // Name MY
    { width: 18 },  // Category
    { width: 14 },  // Zone
    { width: 10 },  // Unit
    { width: 12 },  // Par Level
    { width: 14 },  // Last Cost
    { width: 30 },  // Notes
  ];

  // Example rows to show the expected format
  ws.addRow(['BF', 'Bread Flour', 'ပေါင်မုန့်ညက်', 'FLOUR_LEAVENING', 'DRY', 'KG', 5, 2800, 'High gluten']);
  ws.addRow(['',   'Milk',        'နို့',              'DAIRY',           'COLD', 'L', 4, 3500, '']);
  ws.addRow(['',   'Hot Cup M',   'ဖန်ခွက် (အလယ်)',     'PACKAGING',       'SUPPLIES', 'PCS', 50, 45, '']);

  // Legend sheet — enum values for reference
  const ref = wb.addWorksheet('Reference');
  ref.addRow(['Allowed values']).font = { bold: true };
  ref.addRow([]);
  ref.addRow(['Category values:']).font = { bold: true };
  CATEGORIES.forEach((c) => ref.addRow([c]));
  ref.addRow([]);
  ref.addRow(['Storage Zone values:']).font = { bold: true };
  ZONES.forEach((z) => ref.addRow([z]));
  ref.addRow([]);
  ref.addRow(['Base Unit values:']).font = { bold: true };
  UNITS.forEach((u) => ref.addRow([u]));
  ref.columns = [{ width: 40 }];

  const buffer = await wb.xlsx.writeBuffer();
  const fileName = `pae-ka-yauk-materials-template-${user.tenantId.slice(-6)}.xlsx`;

  return new NextResponse(buffer as ArrayBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    },
  });
}
