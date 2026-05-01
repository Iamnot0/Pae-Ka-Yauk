import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { STAFF_ADMIN_ROLES, STAFF_DELETE_ROLES } from '@/lib/rbac';
import { getStaffById, updateStaff, deleteStaff } from '@/lib/repos/users';

const ROLES = ['OWNER', 'MANAGER', 'CASHIER', 'BAKER'] as const;

const UpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  nameLocal: z.string().trim().max(120).optional().nullable(),
  role: z.enum(ROLES).optional(),
  active: z.boolean().optional(),
  password: z.string().min(6).max(200).optional(),
});

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireRole(...STAFF_ADMIN_ROLES);
  const { id } = await ctx.params;
  const row = await getStaffById(user.tenantId, id);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(row, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireRole(...STAFF_ADMIN_ROLES);
  const { id } = await ctx.params;

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 });
  }

  // Self-demote guard: an admin can't flip their own role away or deactivate themselves.
  if (id === user.id) {
    if (parsed.data.role !== undefined && parsed.data.role !== user.role) {
      return NextResponse.json({ error: "You can't change your own role." }, { status: 400 });
    }
    if (parsed.data.active === false) {
      return NextResponse.json({ error: "You can't deactivate your own account." }, { status: 400 });
    }
  }

  try {
    const row = await updateStaff(user.tenantId, id, parsed.data);
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(row);
  } catch (e) {
    console.error('[users PATCH]', (e as Error).message);
    return NextResponse.json({ error: 'Failed to update staff' }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireRole(...STAFF_DELETE_ROLES);
  const { id } = await ctx.params;

  if (id === user.id) {
    return NextResponse.json({ error: "You can't delete your own account." }, { status: 400 });
  }

  const result = await deleteStaff(user.tenantId, id);
  if (result === 'notFound') return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (result === 'lastOwner') return NextResponse.json({ error: 'Cannot delete the last owner.' }, { status: 400 });
  return NextResponse.json({ ok: true });
}
