/**
 * Prisma client + tenant-scoped extension.
 *
 * Uses the Neon WebSocket adapter so all queries route through port 443
 * (compatible with networks that block TCP port 5432, common on some
 * Myanmar / SEA ISPs).
 *
 * Rule: never use raw `prisma.model` in tenant-scoped code paths.
 * Always use `tenantDb(tenantId).model` — the extension auto-injects
 * `tenantId` into every where/data clause, preventing cross-tenant leaks.
 *
 * Raw `prisma` is reserved for:
 *   - Super-admin operations (Phase 2)
 *   - Seed scripts
 *   - Maintenance tasks
 */

import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

// Node.js needs a WebSocket constructor (browsers use window.WebSocket).
if (typeof window === 'undefined' && !neonConfig.webSocketConstructor) {
  neonConfig.webSocketConstructor = ws;
}

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

function buildPrisma(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }
  const adapter = new PrismaNeon({ connectionString });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });
}

export const prisma = globalThis.prismaGlobal ?? buildPrisma();

if (process.env.NODE_ENV !== 'production') {
  globalThis.prismaGlobal = prisma;
}

// ---------------------------------------------------------------------------
// Tenant scope enforcement
// ---------------------------------------------------------------------------

const TENANT_SCOPED_MODELS = new Set<string>([
  'User',
  'Outlet',
  'RawMaterial',
  'SellableItem',
  'Modifier',
  'Recipe',
  'UnitConversion',
  'Supplier',
  'StockBatch',
  'StockMovement',
  'SaleTransaction',
  'Shift',
  'WasteEntry',
]);

const READ_OPS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
]);

const WRITE_OPS = new Set(['update', 'updateMany', 'delete', 'deleteMany']);
const CREATE_OPS = new Set(['create', 'createMany']);

/**
 * Build a Prisma client that transparently enforces `tenantId = currentTenantId`
 * on every query against tenant-scoped models.
 */
export function tenantDb(tenantId: string) {
  if (!tenantId) {
    throw new Error('tenantDb called without tenantId — refusing to issue unscoped query');
  }

  return prisma.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_SCOPED_MODELS.has(model)) {
            return query(args);
          }

          if (READ_OPS.has(operation) || WRITE_OPS.has(operation)) {
            const a = args as { where?: Record<string, unknown> };
            a.where = { ...(a.where ?? {}), tenantId };
          }

          if (CREATE_OPS.has(operation)) {
            const a = args as { data?: Record<string, unknown> | Record<string, unknown>[] };
            if (Array.isArray(a.data)) {
              a.data = a.data.map((row) => ({ ...row, tenantId }));
            } else if (a.data) {
              a.data = { ...a.data, tenantId };
            }
          }

          if (operation === 'upsert') {
            const a = args as {
              where?: Record<string, unknown>;
              create?: Record<string, unknown>;
            };
            a.where = { ...(a.where ?? {}), tenantId };
            a.create = { ...(a.create ?? {}), tenantId };
          }

          return query(args);
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof tenantDb>;
