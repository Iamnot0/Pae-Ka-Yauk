/**
 * XLSX / CSV parser — returns a normalised shape the wizard can render.
 *
 * Output shape:
 *   { headers: string[], rows: Record<string,string>[], fileName, sheetName }
 *
 * Design:
 *   - Skips empty leading rows (Boss's xlsx has blank rows above headers)
 *   - Uses first non-empty row as headers
 *   - Every cell is stringified (wizard decides typing per column)
 *   - Trims whitespace, drops fully-empty rows
 */

import ExcelJS from 'exceljs';

export interface ParseResult {
  headers: string[];
  rows: Record<string, string>[];
  fileName: string;
  sheetName: string;
  totalRows: number;
}

function cellToString(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  // ExcelJS rich text
  if (typeof v === 'object' && v !== null && 'richText' in v) {
    const rt = (v as { richText: Array<{ text: string }> }).richText;
    return rt.map((r) => r.text).join('').trim();
  }
  // formula result
  if (typeof v === 'object' && v !== null && 'result' in v) {
    return cellToString((v as { result: ExcelJS.CellValue }).result);
  }
  // hyperlink
  if (typeof v === 'object' && v !== null && 'text' in v) {
    return String((v as { text: unknown }).text ?? '').trim();
  }
  return String(v).trim();
}

/** Sentinel column injected by parseXlsx so importers can use the sheet name
 *  as a fallback category (e.g. "Bread" → BAKERY_BREAD when the row's own
 *  Category cell is empty or unrecognised). */
export const SHEET_KEY = '__sheet';

/**
 * Parse XLSX file from a Node Buffer.
 *
 * Real-world owner spreadsheets we've seen:
 *   - Multiple sheets per workbook (Bread / Hot Cold / Cake) — we walk all
 *     of them and concatenate.
 *   - A title row above the headers ("Bread" alone in row 1) — we scan
 *     downward until a row looks like real headers (contains "name").
 *   - Headers with bilingual labels in parentheses ("Name (အမည်)") — the
 *     normaliser keeps the original headers; importers can either match on
 *     a stripped form (see pickHeader()) or use the sheet name fallback.
 */
export async function parseXlsx(buf: Buffer, fileName: string): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook();
  // ExcelJS's bundled .d.ts predates Node 22's generic Buffer<ArrayBufferLike>,
  // so the call typechecks once we widen through `unknown`. Runtime is fine —
  // ExcelJS only needs a Node Buffer.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(buf as any);
  if (wb.worksheets.length === 0) throw new Error('No worksheet found in file');

  const merged: { headers: string[]; rows: Record<string, string>[] } = { headers: [], rows: [] };
  const sheetNames: string[] = [];

  for (const ws of wb.worksheets) {
    const allRows: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      const maxCol = row.cellCount;
      for (let c = 1; c <= maxCol; c++) {
        cells.push(cellToString(row.getCell(c).value));
      }
      allRows.push(cells);
    });

    const sheetParsed = normalise(allRows, fileName, ws.name);
    if (sheetParsed.rows.length === 0) continue;
    sheetNames.push(ws.name);

    // Union the header set across sheets (some sheets may have extra cols).
    for (const h of sheetParsed.headers) {
      if (!merged.headers.includes(h)) merged.headers.push(h);
    }
    for (const r of sheetParsed.rows) {
      merged.rows.push({ ...r, [SHEET_KEY]: ws.name });
    }
  }

  return {
    headers: merged.headers,
    rows: merged.rows,
    fileName,
    sheetName: sheetNames.join(', ') || wb.worksheets[0].name,
    totalRows: merged.rows.length,
  };
}

/** Parse CSV text (RFC 4180-ish — handles quoted fields and escapes). */
export function parseCsv(text: string, fileName: string): ParseResult {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }

    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { cur.push(field); field = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') {
      cur.push(field); field = '';
      if (cur.some((c) => c.trim() !== '')) rows.push(cur);
      cur = []; i++; continue;
    }
    field += ch; i++;
  }
  if (field || cur.length) {
    cur.push(field);
    if (cur.some((c) => c.trim() !== '')) rows.push(cur);
  }

  return normalise(rows.map((r) => r.map((c) => c.trim())), fileName, 'csv');
}

/** Tokens that identify a row as the headers row (case-insensitive, ignoring
 *  spaces and parenthesised hints like "(အမည်)"). At least one match wins. */
const HEADER_HINTS = ['name', 'item', 'product', 'sku', 'category', 'price'];

function looksLikeHeaderRow(row: string[]): boolean {
  // Strip parens content so "Name (အမည်)" → "name". Then test against hints.
  const cleaned = row.map((c) =>
    c.toLowerCase().replace(/\(.*?\)/g, '').replace(/\s+/g, '').trim(),
  );
  // Reject single-cell title rows ("Bread" alone) — real header rows have
  // multiple non-empty cells.
  if (cleaned.filter((c) => c !== '').length < 2) return false;
  return HEADER_HINTS.some((h) => cleaned.includes(h));
}

/** Shared normaliser: find header row, build records. */
function normalise(allRows: string[][], fileName: string, sheetName: string): ParseResult {
  // Filter out fully-empty rows
  const nonEmpty = allRows.filter((r) => r.some((c) => c !== ''));
  if (!nonEmpty.length) {
    return { headers: [], rows: [], fileName, sheetName, totalRows: 0 };
  }

  // Find the header row — usually row 0 but real spreadsheets often have
  // a title row above it. Scan up to row 5 looking for one that contains
  // "name" / "sku" / etc.
  let headerIdx = nonEmpty.findIndex(looksLikeHeaderRow);
  if (headerIdx < 0 || headerIdx > 5) headerIdx = 0; // fall back to first non-empty

  const rawHeaders = nonEmpty[headerIdx];
  const dataStart = headerIdx + 1;
  // De-duplicate header names and drop trailing empties
  const headers: string[] = [];
  const seen = new Map<string, number>();
  for (const h of rawHeaders) {
    const clean = h.trim();
    if (!clean) continue;
    const lower = clean.toLowerCase();
    const n = seen.get(lower) ?? 0;
    seen.set(lower, n + 1);
    headers.push(n === 0 ? clean : `${clean} (${n + 1})`);
  }

  const rows: Record<string, string>[] = [];
  for (let i = dataStart; i < nonEmpty.length; i++) {
    const r = nonEmpty[i];
    const rec: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      rec[headers[c]] = (r[c] ?? '').trim();
    }
    // Skip rows where every mapped cell is empty
    if (Object.values(rec).some((v) => v !== '')) rows.push(rec);
  }

  return { headers, rows, fileName, sheetName, totalRows: rows.length };
}
