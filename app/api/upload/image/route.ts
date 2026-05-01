/**
 * Image upload endpoint — tenant-scoped, size-limited, auto-compressed.
 *
 * Input:  multipart form with `file` (jpg/png/webp, max 5 MB input)
 * Output: { url: string }
 *
 * Process:
 *   1. Validate file type + size
 *   2. Use sharp to resize to 800×800 square-crop center
 *   3. Save as WebP quality 82 (good quality, ~50-150 KB)
 *   4. Upload via storage abstraction (local fs or vercel blob)
 *   5. Return public URL
 */

import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { requireUser } from '@/lib/auth';
import { getStorage, tenantKey } from '@/lib/storage';

const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);
const OUTPUT_SIZE = 800; // 1:1 square — POS tiles

export async function POST(req: Request) {
  const user = await requireUser();

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid upload' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }
  if (file.size > MAX_INPUT_BYTES) {
    return NextResponse.json({ error: 'File too large — max 5 MB' }, { status: 413 });
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json({ error: 'Only JPG, PNG, or WebP images' }, { status: 415 });
  }

  const kind = (formData.get('kind') as string) || 'items';
  if (!['items', 'brand'].includes(kind)) {
    return NextResponse.json({ error: 'Invalid kind' }, { status: 400 });
  }

  try {
    const inputBuffer = Buffer.from(await file.arrayBuffer());

    // Process with sharp: auto-rotate (EXIF), square-crop center, resize, webp encode
    const processed = await sharp(inputBuffer)
      .rotate() // honour EXIF orientation
      .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: 'cover', position: 'centre' })
      .webp({ quality: 82 })
      .toBuffer();

    // Unique-ish filename (timestamp-suffixed to avoid collisions on rapid re-uploads)
    const stamp = Date.now().toString(36);
    const safeStem = file.name
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 40) || 'img';
    const filename = `${safeStem}-${stamp}.webp`;

    const storage = await getStorage();
    const key = tenantKey(user.tenantId, kind as 'items' | 'brand', filename);
    const { url } = await storage.put(key, processed, {
      contentType: 'image/webp',
      overwrite: false,
    });

    return NextResponse.json({ url, size: processed.byteLength });
  } catch (e) {
    console.error('[upload/image]', (e as Error).message);
    return NextResponse.json({ error: 'Image processing failed' }, { status: 500 });
  }
}
