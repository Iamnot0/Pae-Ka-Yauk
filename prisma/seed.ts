/**
 * Seed — creates the Pae Ka Yauk tenant (apartment #1) and an owner user.
 *
 * Intentionally does NOT prefill raw materials, menu items, or recipes.
 * The tenant enters their own data via the import wizard (Sprint 2).
 *
 * Idempotent: running multiple times does not create duplicates.
 */

import { PrismaClient, Role, TenantStatus, Unit } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import bcrypt from 'bcryptjs';

neonConfig.webSocketConstructor = ws;

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('→ Seeding Pae Ka Yauk tenant...');

  const tenant = await prisma.tenant.upsert({
    where: { slug: 'pae-ka-yauk' },
    update: {},
    create: {
      slug: 'pae-ka-yauk',
      name: 'Pae Ka Yauk',
      nameLocal: 'ပဲကရောက်',
      status: TenantStatus.ACTIVE,
      currency: 'MMK',
      locale: 'my-MM',
      timezone: 'Asia/Yangon',
    },
  });
  console.log(`  ✓ Tenant: ${tenant.name} (${tenant.slug})`);

  // Default outlet (single shop)
  const outlet = await prisma.outlet.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: 'Main' } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'Main',
      nameLocal: 'အဓိကဆိုင်',
      timezone: 'Asia/Yangon',
      active: true,
    },
  });
  console.log(`  ✓ Outlet: ${outlet.name}`);

  // Owner user — password: "changeMe123" (must be changed on first login)
  const passwordHash = await bcrypt.hash('changeMe123', 10);
  const pin = await bcrypt.hash('0000', 10);

  const owner = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'owner@pae-ka-yauk.local' } },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'owner@pae-ka-yauk.local',
      passwordHash,
      pin,
      name: 'Owner',
      nameLocal: 'ပိုင်ရှင်',
      role: Role.OWNER,
      active: true,
    },
  });
  console.log(`  ✓ Owner user: ${owner.email} (password: changeMe123 — CHANGE ON FIRST LOGIN)`);

  // Minimal system defaults — unit conversions that are universal
  // (G↔KG, ML↔L, etc.) — NOT material-specific densities. Tenant adds those later.
  const systemConversions: Array<{ from: Unit; to: Unit; factor: number }> = [
    { from: Unit.KG, to: Unit.G,  factor: 1000 },
    { from: Unit.G,  to: Unit.KG, factor: 0.001 },
    { from: Unit.L,  to: Unit.ML, factor: 1000 },
    { from: Unit.ML, to: Unit.L,  factor: 0.001 },
  ];

  for (const c of systemConversions) {
    await prisma.unitConversion.upsert({
      where: {
        tenantId_materialId_fromUnit_toUnit: {
          tenantId: tenant.id,
          materialId: null as unknown as string, // Prisma compound-unique quirk with null
          fromUnit: c.from,
          toUnit: c.to,
        },
      },
      update: {},
      create: {
        tenantId: tenant.id,
        materialId: null,
        fromUnit: c.from,
        toUnit: c.to,
        factor: c.factor,
      },
    }).catch(async () => {
      // Fallback for null-compound-unique: check + create
      const exists = await prisma.unitConversion.findFirst({
        where: { tenantId: tenant.id, materialId: null, fromUnit: c.from, toUnit: c.to },
      });
      if (!exists) {
        await prisma.unitConversion.create({
          data: { tenantId: tenant.id, materialId: null, fromUnit: c.from, toUnit: c.to, factor: c.factor },
        });
      }
    });
  }
  console.log(`  ✓ System unit conversions: ${systemConversions.length}`);

  console.log('');
  console.log('✅ Seed complete.');
  console.log('');
  console.log('  Tenant:   Pae Ka Yauk (pae-ka-yauk)');
  console.log('  Outlet:   Main');
  console.log('  Login:    owner@pae-ka-yauk.local / changeMe123  (change on first login)');
  console.log('  POS PIN:  0000                                    (change immediately)');
  console.log('');
  console.log('  Next: start dev server and use the import wizard to load');
  console.log('        raw materials + menu items + recipes.');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
