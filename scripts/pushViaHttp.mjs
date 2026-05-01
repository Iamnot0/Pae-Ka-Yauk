/**
 * Executes prisma/init.sql against Neon via WebSocket (port 443).
 * Workaround for networks that block outbound TCP port 5432.
 *
 *   node --env-file=.env scripts/pushViaHttp.mjs
 */

import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// In Node.js we must supply a WebSocket constructor; browsers use window.WebSocket.
neonConfig.webSocketConstructor = ws;

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = resolve(__dirname, '../prisma/init.sql');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL missing. Load with --env-file=.env');
  process.exit(1);
}

const pool = new Pool({ connectionString: url });
const client = await pool.connect();

const script = readFileSync(sqlPath, 'utf8');

// Strip -- line comments, then split on `;` at statement boundaries.
// We keep it simple: Prisma's generated SQL uses `;\n` reliably.
const cleaned = script
  .split('\n')
  .filter(line => !line.trim().startsWith('--'))
  .join('\n');

const statements = cleaned
  .split(';')
  .map(s => s.trim())
  .filter(s => s.length > 0);

console.log(`→ Executing ${statements.length} SQL statements against`);
console.log(`  ${new URL(url).hostname}`);
console.log('');

let ok = 0, fail = 0;
for (let i = 0; i < statements.length; i++) {
  const stmt = statements[i];
  const preview = stmt.split('\n')[0].slice(0, 70);
  try {
    await client.query(stmt);
    ok++;
    if (i < 3 || i === statements.length - 1 || i % 10 === 0) {
      console.log(`  ✓ [${String(i + 1).padStart(3, ' ')}/${statements.length}] ${preview}`);
    }
  } catch (e) {
    fail++;
    console.log(`  ✗ [${String(i + 1).padStart(3, ' ')}/${statements.length}] ${preview}`);
    console.log(`      → ${e.message}`);
  }
}

client.release();
await pool.end();

console.log('');
console.log(`Done. ${ok} succeeded, ${fail} failed.`);
if (fail > 0) process.exit(1);
