import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { listModifiers, createModifier } from '@/lib/repos/modifiers';

const Schema = z.object({
  group: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(120),
  nameLocal: z.string().trim().max(120).nullable().optional(),
  priceDelta: z.number(),
  active: z.boolean().optional(),
});

export async function GET() {
  const user = await requireUser();
  const rows = await listModifiers(user.tenantId);
  return NextResponse.json({ rows });
}

export async function POST(req: Request) {
  const user = await requireUser();
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 });
  try {
    const m = await createModifier(user.tenantId, parsed.data);
    return NextResponse.json(m, { status: 201 });
  } catch (e) {
    const msg = (e as Error).message || '';
    if (msg.includes('duplicate key')) {
      return NextResponse.json({ error: 'Modifier with this group + name already exists' }, { status: 409 });
    }
    console.error('[modifiers POST]', msg);
    return NextResponse.json({ error: 'Failed to create modifier' }, { status: 500 });
  }
}
