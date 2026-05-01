import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { STAFF_ADMIN_ROLES } from '@/lib/rbac';
import { listStaff, createStaff } from '@/lib/repos/users';

const ROLES = ['OWNER', 'MANAGER', 'CASHIER', 'BAKER'] as const;

const CreateSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(6).max(200),
  name: z.string().trim().min(1).max(120),
  nameLocal: z.string().trim().max(120).optional().nullable(),
  role: z.enum(ROLES),
});

export async function GET() {
  const user = await requireRole(...STAFF_ADMIN_ROLES);
  try {
    const rows = await listStaff(user.tenantId);
    return NextResponse.json({ rows }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[users GET]', (e as Error).message);
    return NextResponse.json({ error: 'Failed to load staff' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const user = await requireRole(...STAFF_ADMIN_ROLES);

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const row = await createStaff(user.tenantId, parsed.data);
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    const msg = (e as Error).message || '';
    if (msg.includes('users_tenantId_email_key') || msg.includes('duplicate key')) {
      return NextResponse.json({ error: 'That email is already in use.' }, { status: 409 });
    }
    console.error('[users POST]', msg);
    return NextResponse.json({ error: 'Failed to create staff' }, { status: 500 });
  }
}
