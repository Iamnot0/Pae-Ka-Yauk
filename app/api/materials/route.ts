import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import {
  listMaterials,
  createMaterial,
  type MaterialCategory,
  type StorageZone,
  type Unit,
} from '@/lib/repos/materials';

const CATEGORIES = [
  'FLOUR_LEAVENING', 'FAT_OIL', 'DAIRY', 'SWEETENER', 'FRUIT_FILLING',
  'CHOCOLATE_NUT', 'PROTEIN_SAVORY', 'SAUCE_SEASONING', 'COLOR_FLAVOR',
  'BEVERAGE_BASE', 'PACKAGING', 'OTHER',
] as const;
const ZONES = ['COLD', 'DRY', 'SUPPLIES'] as const;
const UNITS = ['G', 'KG', 'ML', 'L', 'PCS', 'BOX', 'CUP', 'PACK', 'CARTON', 'BOTTLE', 'CAN'] as const;
const TRACK_BY = ['WEIGHT', 'COUNT'] as const;

const CreateSchema = z.object({
  code: z.string().trim().max(20).optional().nullable(),
  name: z.string().trim().min(1).max(200),
  nameLocal: z.string().trim().max(200).optional().nullable(),
  category: z.enum(CATEGORIES),
  storageZone: z.enum(ZONES).optional(),
  baseUnit: z.enum(UNITS),
  trackBy: z.enum(TRACK_BY).optional(),
  replenishOnly: z.boolean().optional(),
  tracksExpiry: z.boolean().optional(),
  enforceFifo: z.boolean().optional(),
  parLevel: z.number().nonnegative().nullable().optional(),
  lastUnitCost: z.number().nonnegative().nullable().optional(),
  notes: z.string().max(2000).optional().nullable(),
});

export async function GET(req: Request) {
  const user = await requireUser();
  const { searchParams } = new URL(req.url);

  const result = await listMaterials(user.tenantId, {
    search: searchParams.get('search') || undefined,
    category: (searchParams.get('category') as MaterialCategory | 'ALL' | null) || 'ALL',
    storageZone: (searchParams.get('zone') as StorageZone | 'ALL' | null) || 'ALL',
    includeInactive: searchParams.get('includeInactive') === 'true',
    limit: Number(searchParams.get('limit')) || 200,
    offset: Number(searchParams.get('offset')) || 0,
  });

  return NextResponse.json(result);
}

export async function POST(req: Request) {
  const user = await requireUser();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const material = await createMaterial(user.tenantId, parsed.data);
    return NextResponse.json(material, { status: 201 });
  } catch (e) {
    const msg = (e as Error).message || 'Database error';
    // Postgres unique-violation on (tenantId, name)
    if (msg.includes('raw_materials_tenantId_name_key') || msg.includes('duplicate key')) {
      return NextResponse.json(
        { error: 'A material with this name already exists' },
        { status: 409 }
      );
    }
    console.error('[materials POST]', msg);
    return NextResponse.json({ error: 'Failed to create material' }, { status: 500 });
  }
}
