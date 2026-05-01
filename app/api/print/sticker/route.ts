/**
 * POST /api/print/sticker — print 1+ labels for a sellable item to the
 * NipponPOS / RONGTA label printer connected at /dev/usb/lp0.
 *
 *   Body: { itemId, qty }
 *
 * SKU is guaranteed non-null by `createItem` (auto-generated at creation).
 * Pre-existing items were backfilled by 2026-04-28-backfill-skus.sql.
 *
 * Errors handled:
 *   - itemId not found / wrong tenant      → 404
 *   - Linux device file missing            → 503 (printer not connected)
 *   - User lacks write perms on lp0        → 503 (with hint about the lp group)
 *   - Generic write error                  → 503
 *
 * Auth: any logged-in role may print. Cashiers print at POS, bakers print
 * after a bake — neither is privileged.
 */

import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/neonHttp';
import { buildStickerTspl } from '@/lib/printing/tspl';

export const runtime = 'nodejs';

const Schema = z.object({
  itemId: z.string().min(1),
  qty: z.number().int().positive().max(100),
});

const STICKER_DEVICE = process.env.STICKER_DEVICE || '/dev/usb/lp0';

export async function POST(req: Request) {
  const user = await requireUser();

  const body = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'Invalid payload', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { itemId, qty } = parsed.data;

  const rows = (await sql(
    `SELECT id, name, sku FROM sellable_items
      WHERE id = $1 AND "tenantId" = $2 AND "deletedAt" IS NULL`,
    [itemId, user.tenantId],
  )) as Array<{ id: string; name: string; sku: string | null }>;
  if (rows.length === 0) {
    return NextResponse.json({ ok: false, error: 'Item not found' }, { status: 404 });
  }
  const item = rows[0];
  if (!item.sku) {
    return NextResponse.json(
      { ok: false, error: 'Item has no SKU — should be auto-assigned by createItem' },
      { status: 500 },
    );
  }

  const tspl = buildStickerTspl({ name: item.name, sku: item.sku, qty });

  try {
    await fs.writeFile(STICKER_DEVICE, tspl);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    const code = e.code ?? '';
    let hint = e.message;
    if (code === 'ENOENT') {
      hint = `Sticker printer not connected at ${STICKER_DEVICE}. Plug in the USB cable.`;
    } else if (code === 'EACCES') {
      hint = `Permission denied on ${STICKER_DEVICE}. Run: sudo usermod -aG lp $USER, then log out + back in.`;
    }
    console.error('[sticker] write failed:', code, e.message);
    return NextResponse.json(
      { ok: false, error: hint, code, device: STICKER_DEVICE },
      { status: 503 },
    );
  }

  return NextResponse.json({
    ok: true,
    item: { id: item.id, name: item.name, sku: item.sku },
    qty,
    bytes: tspl.length,
  });
}
