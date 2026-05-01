/**
 * Seed script — resilient version.
 * Uses a fresh PrismaNeon adapter per operation to survive idle
 * WebSocket drops on flaky cross-region links.
 *
 *   node --env-file=.env scripts/seed.mjs
 *
 * Idempotent — safe to re-run.
 */

import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import bcrypt from 'bcryptjs';

neonConfig.webSocketConstructor = ws;

const CONN = process.env.DATABASE_URL;
if (!CONN) throw new Error('DATABASE_URL missing');

/** Run one DB operation with a fresh client. Retries on timeout. */
async function run(label, fn, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: CONN }) });
    try {
      const result = await fn(prisma);
      await prisma.$disconnect();
      console.log(`  ✓ ${label}`);
      return result;
    } catch (e) {
      await prisma.$disconnect().catch(() => {});
      if (i === attempts) {
        console.log(`  ✗ ${label} — failed after ${attempts} tries: ${e.message}`);
        throw e;
      }
      console.log(`  … retry ${i}/${attempts - 1} (${e.code || e.name})`);
      await new Promise(r => setTimeout(r, 1500));
    }
  }
}

console.log('→ Seeding Pae Ka Yauk tenant (resilient mode)...');

// Pre-hash outside the DB loop
const passwordHash = await bcrypt.hash('changeMe123', 10);
const pin = await bcrypt.hash('0000', 10);

// 1. Tenant
const tenant = await run('Tenant', async p => {
  const existing = await p.tenant.findUnique({ where: { slug: 'pae-ka-yauk' } });
  if (existing) return existing;
  return p.tenant.create({
    data: {
      slug: 'pae-ka-yauk',
      name: 'Pae Ka Yauk',
      nameLocal: 'ပဲကရောက်',
      status: 'ACTIVE',
      currency: 'MMK',
      locale: 'my-MM',
      timezone: 'Asia/Yangon',
    },
  });
});

// 2. Outlet
await run('Outlet (Main)', async p => {
  const existing = await p.outlet.findFirst({ where: { tenantId: tenant.id, name: 'Main' } });
  if (existing) return existing;
  return p.outlet.create({
    data: {
      tenantId: tenant.id,
      name: 'Main',
      nameLocal: 'အဓိကဆိုင်',
      timezone: 'Asia/Yangon',
      active: true,
    },
  });
});

// 3. Owner user
await run('Owner user', async p => {
  const existing = await p.user.findFirst({
    where: { tenantId: tenant.id, email: 'owner@pae-ka-yauk.local' },
  });
  if (existing) return existing;
  return p.user.create({
    data: {
      tenantId: tenant.id,
      email: 'owner@pae-ka-yauk.local',
      passwordHash,
      pin,
      name: 'Owner',
      nameLocal: 'ပိုင်ရှင်',
      role: 'OWNER',
      active: true,
    },
  });
});

// 4. Unit conversions
const conversions = [
  { from: 'KG', to: 'G',  factor: 1000 },
  { from: 'G',  to: 'KG', factor: 0.001 },
  { from: 'L',  to: 'ML', factor: 1000 },
  { from: 'ML', to: 'L',  factor: 0.001 },
];

for (const c of conversions) {
  await run(`Unit ${c.from}→${c.to}`, async p => {
    const existing = await p.unitConversion.findFirst({
      where: { tenantId: tenant.id, materialId: null, fromUnit: c.from, toUnit: c.to },
    });
    if (existing) return existing;
    return p.unitConversion.create({
      data: {
        tenantId: tenant.id,
        materialId: null,
        fromUnit: c.from,
        toUnit: c.to,
        factor: c.factor,
      },
    });
  });
}

console.log('');
console.log('✅ Seed complete.');
console.log('');
console.log('  Tenant:   Pae Ka Yauk (pae-ka-yauk)');
console.log('  Outlet:   Main');
console.log('  Login:    owner@pae-ka-yauk.local / changeMe123');
console.log('  POS PIN:  0000');
