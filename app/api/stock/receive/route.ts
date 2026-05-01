import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { receiveStock } from '@/lib/stock/ledger';
import { getMaterial } from '@/lib/repos/materials';

const UNITS = ['G', 'KG', 'ML', 'L', 'PCS', 'BOX', 'CUP', 'PACK', 'CARTON', 'BOTTLE', 'CAN'] as const;

const Schema = z.object({
  materialId: z.string().min(1),
  qty: z.number().positive(),
  unit: z.enum(UNITS),
  unitCost: z.number().nonnegative(),
  receivedAt: z.string().datetime().optional(),
  expiryDate: z.string().datetime().nullable().optional(),
  supplierId: z.string().nullable().optional(),
  invoiceRef: z.string().trim().max(120).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

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

  const material = await getMaterial(user.tenantId, parsed.data.materialId);
  if (!material) {
    return NextResponse.json({ error: 'Material not found' }, { status: 404 });
  }
  if (parsed.data.unit !== material.baseUnit) {
    return NextResponse.json(
      {
        error: `Receive quantity must use the material's base unit (${material.baseUnit}). Unit conversion ships in Sprint 3 step 4.`,
      },
      { status: 400 }
    );
  }
  // Expiry is always optional now (owner pref 2026-04-25). The per-material
  // `tracksExpiry` flag remains in the schema as informational metadata but
  // no longer blocks a receive. If the owner wants to enforce it later, this
  // is the one line to bring back.

  try {
    const result = await receiveStock(user.tenantId, {
      materialId: parsed.data.materialId,
      qty: parsed.data.qty,
      unit: parsed.data.unit,
      unitCost: parsed.data.unitCost,
      receivedAt: parsed.data.receivedAt ? new Date(parsed.data.receivedAt) : undefined,
      expiryDate: parsed.data.expiryDate ? new Date(parsed.data.expiryDate) : null,
      supplierId: parsed.data.supplierId ?? null,
      invoiceRef: parsed.data.invoiceRef ?? null,
      userId: user.id,
      note: parsed.data.note ?? null,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    const msg = (e as Error).message ?? '';
    console.error('[stock/receive POST]', msg);
    return NextResponse.json({ error: 'Receive failed', detail: msg }, { status: 500 });
  }
}
