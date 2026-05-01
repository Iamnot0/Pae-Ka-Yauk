import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { getActiveRecipe, upsertRecipe, deleteActiveRecipe } from '@/lib/repos/recipes';

const UNITS = ['G', 'KG', 'ML', 'L', 'PCS', 'BOX', 'CUP', 'PACK', 'CARTON', 'BOTTLE', 'CAN'] as const;

const Schema = z.object({
  itemId: z.string().min(1),
  yield: z.number().positive(),
  yieldUnit: z.enum(UNITS),
  wasteFactor: z.number().min(0).max(1).optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  ingredients: z.array(z.object({
    materialId: z.string().min(1),
    quantity: z.number().positive(),
    unit: z.enum(UNITS),
    note: z.string().trim().max(200).nullable().optional(),
    sortOrder: z.number().int().optional(),
  })).min(1),
});

// GET /api/recipes?itemId=...
export async function GET(req: Request) {
  const user = await requireUser();
  const url = new URL(req.url);
  const itemId = url.searchParams.get('itemId');
  if (!itemId) return NextResponse.json({ error: 'itemId required' }, { status: 400 });
  const recipe = await getActiveRecipe(user.tenantId, itemId);
  return NextResponse.json({ recipe });
}

// POST /api/recipes — create or replace active recipe for an item
export async function POST(req: Request) {
  const user = await requireUser();
  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const recipe = await upsertRecipe(user.tenantId, parsed.data);
    return NextResponse.json(recipe, { status: 201 });
  } catch (e) {
    const msg = (e as Error).message ?? '';
    console.error('[recipes POST]', msg);
    return NextResponse.json({ error: msg || 'Failed to save recipe' }, { status: 500 });
  }
}

// DELETE /api/recipes?itemId=...
export async function DELETE(req: Request) {
  const user = await requireUser();
  const url = new URL(req.url);
  const itemId = url.searchParams.get('itemId');
  if (!itemId) return NextResponse.json({ error: 'itemId required' }, { status: 400 });
  await deleteActiveRecipe(user.tenantId, itemId);
  return NextResponse.json({ ok: true });
}
