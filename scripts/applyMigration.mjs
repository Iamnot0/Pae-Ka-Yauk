/**
 * Apply a targeted migration SQL file over Neon via WebSocket (port 443).
 *
 *   node --env-file=.env scripts/applyMigration.mjs prisma/migrations/<file>.sql
 *
 * IMPORTANT: Enum-extension statements (ALTER TYPE ... ADD VALUE) must NOT
 * run inside a transaction, so we run each statement one-by-one without
 * BEGIN/COMMIT.
 */

import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

neonConfig.webSocketConstructor = ws;

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL missing'); process.exit(1); }

const file = process.argv[2];
if (!file) { console.error('Usage: applyMigration.mjs <path/to/file.sql>'); process.exit(1); }

const sqlText = readFileSync(resolve(file), 'utf8');

// Split on semicolons, but keep `$$ ... $$` blocks intact.
const statements = [];
let buf = '';
let inDollar = false;
for (const line of sqlText.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('--')) continue;
  buf += line + '\n';
  const dollarCount = (line.match(/\$\$/g) ?? []).length;
  if (dollarCount % 2 === 1) inDollar = !inDollar;
  if (!inDollar && trimmed.endsWith(';')) {
    statements.push(buf.trim());
    buf = '';
  }
}
if (buf.trim()) statements.push(buf.trim());

const pool = new Pool({ connectionString: url });
const client = await pool.connect();

console.log(`→ applying ${statements.length} statements from ${file}\n`);

let ok = 0, fail = 0;
for (let i = 0; i < statements.length; i++) {
  const stmt = statements[i];
  const preview = stmt.replace(/\s+/g, ' ').slice(0, 80);
  try {
    await client.query(stmt);
    ok++;
    console.log(`  ✓ [${i + 1}/${statements.length}] ${preview}`);
  } catch (e) {
    fail++;
    console.log(`  ✗ [${i + 1}/${statements.length}] ${preview}`);
    console.log(`      → ${e.message}`);
  }
}

client.release();
await pool.end();
console.log(`\nDone. ${ok} ok · ${fail} failed.`);
if (fail) process.exit(1);
