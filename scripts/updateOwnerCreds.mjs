/**
 * Update the owner user's email + password.
 * Uses Neon HTTP driver (port 443 — reliable on Clay's network).
 *
 *   node --env-file=.env scripts/updateOwnerCreds.mjs
 */

import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';

const sql = neon(process.env.DATABASE_URL);

const NEW_EMAIL = 'admin@paekayauk.com';
const NEW_PASSWORD = 'PaeKaYauk@2026';

console.log('→ Hashing new password...');
const passwordHash = await bcrypt.hash(NEW_PASSWORD, 10);

// Find the OWNER user for the Pae Ka Yauk tenant (identified by role, not email)
const tenants = await sql`SELECT id FROM tenants WHERE slug = 'pae-ka-yauk' LIMIT 1`;
if (!tenants[0]) throw new Error('Tenant pae-ka-yauk not found');
const tenantId = tenants[0].id;

const result = await sql`
  UPDATE users
  SET email = ${NEW_EMAIL}, "passwordHash" = ${passwordHash}
  WHERE "tenantId" = ${tenantId} AND role = 'OWNER'
  RETURNING id, email, role
`;

if (result.length === 0) {
  console.log('  ⚠ No OWNER user found — creating a fresh one.');
  const pin = await bcrypt.hash('0000', 10);
  const created = await sql`
    INSERT INTO users (id, "tenantId", email, "passwordHash", pin, name, "nameLocal", role, active, "createdAt", "updatedAt")
    VALUES (
      ${'cuid-' + Math.random().toString(36).slice(2)},
      ${tenantId},
      ${NEW_EMAIL},
      ${passwordHash},
      ${pin},
      'Owner',
      'ပိုင်ရှင်',
      'OWNER',
      true,
      NOW(),
      NOW()
    )
    RETURNING id, email, role
  `;
  console.log('  ✓ Created:', created[0]);
} else {
  console.log('  ✓ Updated:', result[0]);
}

console.log('');
console.log('✅ Done. Login with:');
console.log(`   Email:    ${NEW_EMAIL}`);
console.log(`   Password: ${NEW_PASSWORD}`);
