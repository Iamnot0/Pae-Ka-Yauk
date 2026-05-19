#!/usr/bin/env node
/**
 * archiveOldSales.mjs — daily cold-storage archiver.
 *
 * For each transactional table, exports rows older than 30 days into a
 * gzipped JSONL file under /home/paekayauk/archive/{YYYY-MM}/{table}.jsonl.gz,
 * optionally uploads the file to Google Drive, then deletes the archived
 * rows from the local Postgres. The DELETE fires sync_outbox triggers so
 * Neon mirrors the cleanup automatically.
 *
 * SAFETY:
 *   - Default mode is DRY-RUN. No DELETE, no GDrive upload. Pass --apply
 *     to enable destructive operations.
 *   - DELETE only runs AFTER successful local archive write.
 *   - DELETE uses children-first ordering (sale_lines before sale_transactions
 *     etc.) so foreign keys never block.
 *
 * Env:
 *   DATABASE_URL                    — local Parrot Postgres (required)
 *   ARCHIVE_DIR                     — output dir (default /home/paekayauk/archive)
 *   ARCHIVE_RETENTION_DAYS          — hot-window size in days (default 30)
 *   GOOGLE_SERVICE_ACCOUNT_JSON     — path to GDrive service-account key
 *                                     (omit → no GDrive upload)
 *   GDRIVE_ARCHIVE_FOLDER_ID        — Drive folder to upload into
 *                                     (required if SERVICE_ACCOUNT set)
 *
 * Usage:
 *   node scripts/archiveOldSales.mjs                         # dry run, prints counts
 *   node scripts/archiveOldSales.mjs --month 2026-04         # archive specific YYYY-MM
 *   node scripts/archiveOldSales.mjs --apply                 # writes + DELETEs
 *   node scripts/archiveOldSales.mjs --apply --month 2026-04 # both
 *
 * Run via systemd timer paekayauk-archive.timer (daily 02:00 Yangon).
 */

import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

const { Pool } = pg;
const gzipAsync = promisify(gzip);

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// Children before parents (FK-safe order). Each entry has a date column used
// to age-filter rows. `tableName` is wrapped in double quotes by the SQL
// template — schema uses snake_case so no quoting actually needed, but kept
// for safety against future renames.
// sale_lines has NO date column of its own — its archive window is driven
// by the parent sale_transactions."createdAt" via the saleId FK. All other
// listed tables carry their own "createdAt" timestamp.
const ARCHIVE_TABLES = [
  { table: 'sale_lines',         dateColumn: '"createdAt"', parent: 'sale_transactions', parentJoinKey: '"saleId"' },
  { table: 'sale_transactions',  dateColumn: '"createdAt"', parent: null },
  { table: 'stock_adjustments',  dateColumn: '"createdAt"', parent: null },
  { table: 'stock_movements',    dateColumn: '"createdAt"', parent: null },
  { table: 'waste_entries',      dateColumn: '"createdAt"', parent: null },
  { table: 'production_batches', dateColumn: '"createdAt"', parent: null },
];

// stock_batches isn't archived: still-open batches with remainingQty > 0 must
// stay regardless of age, and old empty batches can be GC'd by a separate
// vacuum pass later. Keeping them avoids accidentally severing FIFO links.

const RETENTION_DAYS = Number(process.env.ARCHIVE_RETENTION_DAYS ?? 30);
const ARCHIVE_DIR = process.env.ARCHIVE_DIR ?? '/home/paekayauk/archive';
const LOCAL_URL = process.env.DATABASE_URL;
const GSA_PATH  = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
const GDRIVE_FOLDER = process.env.GDRIVE_ARCHIVE_FOLDER_ID;

if (!LOCAL_URL) {
  console.error('[archive] DATABASE_URL is required');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// CLI parsing — keep it simple, no dep
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const monthIdx = args.indexOf('--month');
const SPECIFIC_MONTH = monthIdx >= 0 ? args[monthIdx + 1] : null;

if (SPECIFIC_MONTH && !/^\d{4}-\d{2}$/.test(SPECIFIC_MONTH)) {
  console.error('[archive] --month must be YYYY-MM (e.g. 2026-04)');
  process.exit(1);
}

const mode = APPLY ? 'APPLY (destructive)' : 'DRY-RUN (read-only)';
console.log(`[archive] ${mode}`);
if (SPECIFIC_MONTH) console.log(`[archive] target month: ${SPECIFIC_MONTH}`);
else console.log(`[archive] target: rows older than ${RETENTION_DAYS} days`);

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const pool = new Pool({ connectionString: LOCAL_URL, ssl: false });

async function main() {
  await pool.query('SELECT 1'); // health check
  console.log('[archive] connected to local Postgres');

  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });

  const summary = [];
  for (const t of ARCHIVE_TABLES) {
    const result = await archiveTable(t);
    summary.push(result);
  }

  console.log('\n[archive] summary:');
  for (const s of summary) {
    console.log(`  ${s.table.padEnd(20)} rows=${String(s.rows).padStart(6)} bytes=${String(s.bytes).padStart(9)} deleted=${s.deleted ? 'YES' : 'no'}`);
  }
  await pool.end();
}

async function archiveTable({ table, dateColumn, parent, parentJoinKey }) {
  // Child tables (sale_lines) carry no date — get it from parent via JOIN.
  const useParent = !!parent && !!parentJoinKey;
  const fromClause = useParent
    ? `${table} c JOIN ${parent} p ON p.id = c.${parentJoinKey}`
    : table;
  const selectClause = useParent
    ? `c.*, p.${dateColumn} AS "_parentDate"`
    : '*';
  const dateExpr = useParent ? `p.${dateColumn}` : dateColumn;

  let where, params;
  if (SPECIFIC_MONTH) {
    where = `${dateExpr} >= $1::date AND ${dateExpr} < ($1::date + INTERVAL '1 month')`;
    params = [`${SPECIFIC_MONTH}-01`];
  } else {
    where = `${dateExpr} < NOW() - INTERVAL '${RETENTION_DAYS} days'`;
    params = [];
  }

  const sel = await pool.query(
    `SELECT ${selectClause} FROM ${fromClause} WHERE ${where} ORDER BY ${dateExpr}`,
    params,
  );
  if (sel.rows.length === 0) {
    return { table, rows: 0, bytes: 0, deleted: false, file: null };
  }

  // Group by month using either the row's own date or the JOIN'd parent date.
  const byMonth = new Map();
  for (const row of sel.rows) {
    let ts;
    if (useParent) {
      ts = row._parentDate;
      delete row._parentDate; // keep the archive file clean of synthetic cols
    } else {
      const dCol = dateColumn.replace(/"/g, '');
      ts = row[dCol];
    }
    const d = ts instanceof Date ? ts : new Date(ts);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(row);
  }

  let totalBytes = 0;
  let lastFile = null;
  for (const [month, rows] of byMonth) {
    const monthDir = path.join(ARCHIVE_DIR, month);
    fs.mkdirSync(monthDir, { recursive: true });
    const file = path.join(monthDir, `${table}.jsonl.gz`);

    const jsonl = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
    const gz = await gzipAsync(Buffer.from(jsonl));
    fs.writeFileSync(file, gz);

    totalBytes += gz.length;
    lastFile = file;

    if (GSA_PATH && GDRIVE_FOLDER && APPLY) {
      try {
        await uploadToDrive(file, `${month}/${table}.jsonl.gz`);
      } catch (e) {
        console.warn(`[archive] GDrive upload failed for ${file}: ${e?.message ?? e}`);
        // Don't proceed to DELETE if upload fails
        return { table, rows: rows.length, bytes: totalBytes, deleted: false, file };
      }
    }
  }

  // DELETE only with --apply, and only if archive write succeeded.
  let deleted = false;
  if (APPLY) {
    // For child tables the WHERE references parent's date, so the DELETE has
    // to USING the parent (Postgres' join-aware delete form).
    const delQuery = useParent
      ? `DELETE FROM ${table} c USING ${parent} p WHERE p.id = c.${parentJoinKey} AND ${where}`
      : `DELETE FROM ${table} WHERE ${where}`;
    const del = await pool.query(delQuery, params);
    deleted = del.rowCount > 0;
    console.log(`[archive]   ${table}: archived ${sel.rows.length} → DELETE ${del.rowCount} (sync_outbox triggers will mirror to Neon)`);
  } else {
    console.log(`[archive]   ${table}: archived ${sel.rows.length} rows (DRY-RUN, no DELETE)`);
  }

  return { table, rows: sel.rows.length, bytes: totalBytes, deleted, file: lastFile };
}

// ---------------------------------------------------------------------------
// Google Drive upload — opt-in via env. Skip if creds missing.
// ---------------------------------------------------------------------------

async function uploadToDrive(filePath, displayName) {
  // Lazy require so the script runs without the googleapis dep installed
  // when GDrive isn't configured.
  let google;
  try {
    ({ google } = await import('googleapis'));
  } catch {
    throw new Error('googleapis package not installed; npm i googleapis to enable GDrive upload');
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: GSA_PATH,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });
  const drive = google.drive({ version: 'v3', auth });
  await drive.files.create({
    requestBody: {
      name: displayName.replace(/\//g, '__'),
      parents: [GDRIVE_FOLDER],
      mimeType: 'application/gzip',
    },
    media: {
      mimeType: 'application/gzip',
      body: fs.createReadStream(filePath),
    },
    fields: 'id,name',
  });
  console.log(`[archive]   uploaded to GDrive: ${displayName}`);
}

main().catch((e) => {
  console.error('[archive] fatal:', e);
  process.exit(1);
});
