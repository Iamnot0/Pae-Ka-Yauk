import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import {
  getMaterial,
  updateMaterial,
  softDeleteMaterial,
} from '@/lib/repos/materials';

const CATEGORIES = [
  'FLOUR_LEAVENING', 'FAT_OIL', 'DAIRY', 'SWEETENER', 'FRUIT_FILLING',
  'CHOCOLATE_NUT', 'PROTEIN_SAVORY', 'SAUCE_SEASONING', 'COLOR_FLAVOR',
  'BEVERAGE_BASE', 'PACKAGING', 'OTHER',
] as const;
const ZONES = ['COLD', 'DRY', 'SUPPLIES'] as const;
const UNITS = ['G', 'KG', 'ML', 'L', 'PCS', 'BOX', 'CUP', 'PACK', 'CARTON', 'BOTTLE', 'CAN'] as const;
const TRACK_BY = ['WEIGHT', 'COUNT'] as const;

const UpdateSchema = z.object({
  code: z.string().trim().max(20).nullable().optional(),
  name: z.string().trim().min(1).max(200).optional(),
  nameLocal: z.string().trim().max(200).nullable().optional(),
  category: z.enum(CATEGORIES).optional(),
  storageZone: z.enum(ZONES).optional(),
  baseUnit: z.enum(UNITS).optional(),
  trackBy: z.enum(TRACK_BY).optional(),
  replenishOnly: z.boolean().optional(),
  tracksExpiry: z.boolean().optional(),
  enforceFifo: z.boolean().optional(),
  parLevel: z.number().nonnegative().nullable().optional(),
  lastUnitCost: z.number().nonnegative().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  active: z.boolean().optional(),
});

// Next.js 16: params is async
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const user = await requireUser();
  const { id } = await params;
  const material = await getMaterial(user.tenantId, id);
  if (!material) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(material);
}

export async function PATCH(req: Request, { params }: Ctx) {
  const user = await requireUser();
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const updated = await updateMaterial(user.tenantId, id, parsed.data);
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (e) {
    const msg = (e as Error).message || 'Database error';
    if (msg.includes('raw_materials_tenantId_name_key') || msg.includes('duplicate key')) {
      return NextResponse.json(
        { error: 'A material with this name already exists' },
        { status: 409 }
      );
    }
    console.error('[materials PATCH]', msg);
    return NextResponse.json({ error: 'Failed to update material' }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await requireUser();
  const { id } = await params;
  const ok = await softDeleteMaterial(user.tenantId, id);
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
