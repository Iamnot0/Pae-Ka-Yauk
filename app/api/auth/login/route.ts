import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { sql } from '@/lib/neonHttp';
import { signSession } from '@/lib/auth';

/**
 * Uses the shared retry-wrapped HTTP driver from `lib/neonHttp.ts` so
 * Neon free-tier cold-starts (first query after compute suspend) don't
 * cause a login failure. Four attempts with exponential backoff —
 * transparent to the caller.
 */

const LoginSchema = z.object({
  email: z.string().email().trim().toLowerCase(),
  password: z.string().min(1).max(200),
});

// Dummy bcrypt hash used when email is unknown — keeps timing constant to
// prevent username enumeration via response time.
const DUMMY_HASH = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8.LTfjgl4o4C8Z4m5dD4sJ9j5fZpJq';

interface UserRow {
  id: string;
  tenantId: string;
  role: string;
  passwordHash: string;
  active: boolean;
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 400 });
  }
  const { email, password } = parsed.data;

  let user: UserRow | undefined;
  try {
    const rows = (await sql`
      SELECT id, "tenantId", role, "passwordHash", active
      FROM users
      WHERE email = ${email} AND active = true
      LIMIT 1
    `) as UserRow[];
    user = rows[0];
  } catch (e) {
    console.error('[login] DB query failed:', (e as Error).message);
    return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 });
  }

  // Always run compare for constant-time behaviour
  const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !valid) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
  }

  await signSession({ userId: user.id, tenantId: user.tenantId, role: user.role });

  // Fire-and-forget: last-login update + prime a few hot-path reads so the
  // first page after login doesn't pay the Neon cold-start tax again.
  Promise.all([
    sql`UPDATE users SET "lastLoginAt" = NOW() WHERE id = ${user.id}`,
    sql`SELECT 1 FROM tenants WHERE id = ${user.tenantId} LIMIT 1`,
    sql`SELECT 1 FROM raw_materials WHERE "tenantId" = ${user.tenantId} LIMIT 1`,
  ]).catch((e: unknown) => console.error('[login] warm-up failed:', (e as Error).message));

  return NextResponse.json({ ok: true });
}
