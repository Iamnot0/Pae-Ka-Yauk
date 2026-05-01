import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { updateModifier, deleteModifier } from '@/lib/repos/modifiers';

const UpdateSchema = z.object({
  group: z.string().trim().min(1).max(60).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  nameLocal: z.string().trim().max(120).nullable().optional(),
  priceDelta: z.number().optional(),
  active: z.boolean().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const user = await requireUser();
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 });
  const updated = await updateModifier(user.tenantId, id, parsed.data);
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await requireUser();
  const { id } = await params;
  const ok = await deleteModifier(user.tenantId, id);
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
