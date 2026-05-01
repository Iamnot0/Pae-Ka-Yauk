/**
 * Internal endpoint — accepts a file upload, parses it, returns headers+rows.
 * Used only by the import wizard. Size-limited; requires auth.
 */

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { parseXlsx, parseCsv } from '@/lib/import/parse';

const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(req: Request) {
  await requireUser();

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
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File too large — max 5 MB' }, { status: 413 });
  }

  const name = file.name.toLowerCase();
  const isXlsx = name.endsWith('.xlsx') || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const isCsv = name.endsWith('.csv') || file.type === 'text/csv';

  try {
    if (isXlsx) {
      const buf = Buffer.from(await file.arrayBuffer());
      const result = await parseXlsx(buf, file.name);
      return NextResponse.json(result);
    }
    if (isCsv) {
      const text = await file.text();
      const result = parseCsv(text, file.name);
      return NextResponse.json(result);
    }
    return NextResponse.json({ error: 'Unsupported file type — use .xlsx or .csv' }, { status: 415 });
  } catch (e) {
    console.error('[import/parse]', (e as Error).message);
    return NextResponse.json({ error: 'Could not read file — please check the format.' }, { status: 400 });
  }
}
