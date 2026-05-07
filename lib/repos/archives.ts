/**
 * Server-side helpers for the /historical-sales page.
 *
 * Archives live in two places:
 *   1. Local disk on the cashier station: ARCHIVE_DIR/{YYYY-MM}/{table}.jsonl.gz
 *   2. (Optional) Google Drive folder GDRIVE_ARCHIVE_FOLDER_ID
 *
 * Vercel-served Next.js can only see (2). Parrot-served Next.js can see (1)
 * and (2). For tonight we only wire (1); the GDrive code-path is a TODO
 * that activates the moment Boss provides the service-account JSON.
 */

import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';

const gunzipAsync = promisify(gunzip);

export const ARCHIVE_DIR = process.env.ARCHIVE_DIR ?? '/home/paekayauk/archive';

export interface ArchiveMonth {
  /** YYYY-MM */
  month: string;
  /** Table → file size in bytes */
  tables: Record<string, number>;
  /** Total archived bytes across tables for this month */
  totalBytes: number;
}

export function listArchiveMonths(): ArchiveMonth[] {
  if (!fs.existsSync(ARCHIVE_DIR)) return [];
  const entries = fs.readdirSync(ARCHIVE_DIR, { withFileTypes: true });
  const months: ArchiveMonth[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!/^\d{4}-\d{2}$/.test(entry.name)) continue;
    const monthDir = path.join(ARCHIVE_DIR, entry.name);
    const tables: Record<string, number> = {};
    let totalBytes = 0;
    for (const f of fs.readdirSync(monthDir)) {
      if (!f.endsWith('.jsonl.gz')) continue;
      const table = f.replace(/\.jsonl\.gz$/, '');
      const size = fs.statSync(path.join(monthDir, f)).size;
      tables[table] = size;
      totalBytes += size;
    }
    if (Object.keys(tables).length > 0) {
      months.push({ month: entry.name, tables, totalBytes });
    }
  }
  // newest first
  months.sort((a, b) => b.month.localeCompare(a.month));
  return months;
}

export async function readArchive(month: string, table: string): Promise<unknown[]> {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('invalid month format');
  if (!/^[a-z_]+$/.test(table))     throw new Error('invalid table name');
  const file = path.join(ARCHIVE_DIR, month, `${table}.jsonl.gz`);
  if (!fs.existsSync(file)) return [];
  const gz = fs.readFileSync(file);
  const buf = await gunzipAsync(gz);
  const text = buf.toString('utf8');
  const lines = text.split('\n').filter(Boolean);
  return lines.map((line) => JSON.parse(line));
}
