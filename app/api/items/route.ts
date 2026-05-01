import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { listItems, createItem, type ItemCategory } from '@/lib/repos/items';

const CATEGORIES = [
  'BAKERY_BREAD', 'BAKERY_CAKE', 'BAKERY_COOKIES', 'BAKERY_PASTRY', 'BAKERY_SAVORY',
  'COFFEE_HOT', 'COFFEE_COLD', 'TEA', 'COLD_DRINK', 'DESSERT', 'OTHER',
] as const;

const UNITS = ['PCS', 'BOX', 'PACK', 'CUP', 'BOTTLE'] as const;

// ISO calendar date yyyy-mm-dd. Postgres `date` accepts this directly.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const CreateSchema = z.object({
  sku: z.string().trim().max(40).nullable().optional(),
  name: z.string().trim().min(1).max(200),
  nameLocal: z.string().trim().max(200).nullable().optional(),
  category: z.enum(CATEGORIES),
  price: z.number().nonnegative(),
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

export async function GET(req: Request) {
  const user = await requireUser();
  const { searchParams } = new URL(req.url);
  const result = await listItems(user.tenantId, {
    search: searchParams.get('search') || undefined,
    category: (searchParams.get('category') as ItemCategory | 'ALL' | null) || 'ALL',
    includeInactive: searchParams.get('includeInactive') === 'true',
    limit: Number(searchParams.get('limit')) || 500,
    offset: Number(searchParams.get('offset')) || 0,
  });
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  const user = await requireUser();
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const item = await createItem(user.tenantId, parsed.data);
    return NextResponse.json(item, { status: 201 });
  } catch (e) {
    const msg = (e as Error).message || 'Database error';
    if (msg.includes('duplicate key')) {
      return NextResponse.json({ error: 'Item with this name already exists' }, { status: 409 });
    }
    console.error('[items POST]', msg);
    return NextResponse.json({ error: 'Failed to create item' }, { status: 500 });
  }
}
