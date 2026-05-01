import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { getItem, updateItem, softDeleteItem } from '@/lib/repos/items';

const CATEGORIES = [
  'BAKERY_BREAD', 'BAKERY_CAKE', 'BAKERY_COOKIES', 'BAKERY_PASTRY', 'BAKERY_SAVORY',
  'COFFEE_HOT', 'COFFEE_COLD', 'TEA', 'COLD_DRINK', 'DESSERT', 'OTHER',
] as const;

const UNITS = ['PCS', 'BOX', 'PACK', 'CUP', 'BOTTLE'] as const;

// ISO calendar date yyyy-mm-dd. Postgres `date` accepts this directly.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const UpdateSchema = z.object({
  sku: z.string().trim().max(40).nullable().optional(),
  name: z.string().trim().min(1).max(200).optional(),
  nameLocal: z.string().trim().max(200).nullable().optional(),
  category: z.enum(CATEGORIES).optional(),
  price: z.number().nonnegative().optional(),
  manualCost: z.number().nonnegative().nullable().optional(),
  taxRate: z.number().min(0).max(1).optional(),
  imageUrl: z.string().trim().max(1000).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  productionMode: z.enum(['DIRECT', 'BATCH']).optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  piecesPerPack: z.number().int().positive().nullable().optional(),
  shelfLifeDays: z.number().int().positive().nullable().optional(),
  expiryDate: z.string().regex(ISO_DATE).nullable().optional(),
  unit: z.enum(UNITS).nullable().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const user = await requireUser();
  const { id } = await params;
  const item = await getItem(user.tenantId, id);
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(item);
}

export async function PATCH(req: Request, { params }: Ctx) {
  const user = await requireUser();
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const updated = await updateItem(user.tenantId, id, parsed.data);
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (e) {
    const msg = (e as Error).message || 'Database error';
    if (msg.includes('duplicate key')) {
      return NextResponse.json({ error: 'Item with this name already exists' }, { status: 409 });
    }
    console.error('[items PATCH]', msg);
    return NextResponse.json({ error: 'Failed to update item' }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await requireUser();
  const { id } = await params;
  const ok = await softDeleteItem(user.tenantId, id);
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
