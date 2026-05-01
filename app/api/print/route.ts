/**
 * POST /api/print — send a pre-rendered slip bitmap to the Epson TM printer
 * over TCP port 9100.
 *
 * Why bitmap + native barcode (not pure ESC/POS text):
 *   The TM-series firmware has no Myanmar codepage. Burmese text rendered
 *   via ESC/POS text commands prints as boxes. The client (browser) already
 *   knows how to render Myanmar — it has the fonts loaded. So the client
 *   rasterises the entire slip (header, items, totals, thank-you) to a
 *   1-bpp bitmap and posts it here. We wrap the bitmap with native barcode
 *   + cut commands, which stay printer-rendered for scanability.
 *
 * Portability: net.createConnection is a pure Node API. No Vercel-specific
 * APIs, no drivers, no CUPS. Config is a single env var: PRINTER_HOST.
 *
 * Auth: requireUser() (throws → 401). Any authenticated role that reaches
 * the POS screen can trigger a print.
 */

import { NextResponse } from 'next/server';
import net from 'node:net';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import * as esc from '@/lib/printing/escpos';

export const runtime = 'nodejs';

const payloadSchema = z.object({
  bitmapBase64: z.string().min(1),
  widthPx: z.number().int().positive().refine((v) => v % 8 === 0, {
    message: 'widthPx must be a multiple of 8',
  }),
  heightPx: z.number().int().positive().max(4096),
  barcodeValue: z.string().min(1).max(48),
  openDrawer: z.boolean().optional().default(false),
});

const DEFAULT_HOST = '192.168.192.168';
const DEFAULT_PORT = 9100;
const CONNECT_TIMEOUT_MS = 5_000;

export async function POST(req: Request) {
  await requireUser();

  const body = await req.json().catch(() => null);
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'Invalid payload', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const host = process.env.PRINTER_HOST || DEFAULT_HOST;
  const port = Number(process.env.PRINTER_PORT || DEFAULT_PORT);

  let bitmap: Uint8Array;
  try {
    bitmap = Uint8Array.from(Buffer.from(parsed.data.bitmapBase64, 'base64'));
  } catch {
    return NextResponse.json({ ok: false, error: 'Bad base64 bitmap' }, { status: 400 });
  }

  const { widthPx, heightPx, barcodeValue, openDrawer } = parsed.data;

  let stream: Buffer;
  try {
    stream = Buffer.concat([
      esc.init(),
      esc.alignCenter(),
      esc.rasterBitmap(bitmap, widthPx, heightPx),
      esc.lf(2),
      esc.barcodeCode128(barcodeValue),
      esc.lf(),
      esc.text(barcodeValue),
      esc.lf(),
      esc.feed(3),
      esc.cut(),
      ...(openDrawer ? [esc.openDrawer()] : []),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Bitmap build failed';
    console.error(`[POST /api/print] build error — ${msg}`);
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }

  try {
    await writeToPrinter(host, port, stream, CONNECT_TIMEOUT_MS);
    return NextResponse.json({ ok: true, bytes: stream.length, host, port });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Printer unreachable';
    console.error(`[POST /api/print] ${host}:${port} — ${msg}`);
    return NextResponse.json({ ok: false, error: msg, host, port }, { status: 503 });
  }
}

/**
 * Opens a TCP connection, writes the byte stream, and resolves once the
 * socket has closed cleanly. Rejects on connect error, write error, or
 * timeout. The socket is always destroyed to prevent FD leaks.
 */
function writeToPrinter(host: string, port: number, data: Buffer, timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    const sock = net.createConnection({ host, port });
    let settled = false;

    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      if (err) reject(err);
      else resolve();
    };

    sock.setTimeout(timeoutMs);
    sock.once('connect', () => {
      sock.write(data, (err) => {
        if (err) done(err);
        else sock.end();
      });
    });
    sock.once('close', () => done());
    sock.once('error', done);
    sock.once('timeout', () => done(new Error(`Printer timeout after ${timeoutMs}ms`)));
  });
}
