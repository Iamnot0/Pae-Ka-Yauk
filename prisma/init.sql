-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'TRIAL', 'SUSPENDED', 'CHURNED');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'MANAGER', 'CASHIER', 'BAKER');

-- CreateEnum
CREATE TYPE "MaterialCategory" AS ENUM ('FLOUR_LEAVENING', 'FAT_OIL', 'DAIRY', 'SWEETENER', 'FRUIT_FILLING', 'CHOCOLATE_NUT', 'PROTEIN_SAVORY', 'SAUCE_SEASONING', 'COLOR_FLAVOR', 'BEVERAGE_BASE', 'PACKAGING', 'OTHER');

-- CreateEnum
CREATE TYPE "StorageZone" AS ENUM ('COLD', 'DRY', 'SUPPLIES');

-- CreateEnum
CREATE TYPE "TrackingMode" AS ENUM ('WEIGHT', 'COUNT');

-- CreateEnum
CREATE TYPE "Unit" AS ENUM ('G', 'KG', 'ML', 'L', 'PCS', 'BOX', 'PACK', 'CARTON', 'BOTTLE', 'CAN');

-- CreateEnum
CREATE TYPE "ItemCategory" AS ENUM ('BAKERY_BREAD', 'BAKERY_CAKE', 'BAKERY_PASTRY', 'BAKERY_SAVORY', 'COFFEE_HOT', 'COFFEE_COLD', 'TEA', 'COLD_DRINK', 'DESSERT', 'OTHER');

-- CreateEnum
CREATE TYPE "MovementKind" AS ENUM ('IN', 'OUT', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "MovementReason" AS ENUM ('PURCHASE', 'RETURN_TO_SUPPLIER', 'TRANSFER_IN', 'TRANSFER_OUT', 'SALE', 'WASTE', 'COUNT_CORRECTION', 'OPENING_BALANCE');

-- CreateEnum
CREATE TYPE "WasteReason" AS ENUM ('SPOILED', 'OVERPRODUCTION', 'STAFF_MEAL', 'TESTING', 'CUSTOMER_RETURN', 'BREAKAGE', 'THEFT', 'OTHER');

-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('COMPLETED', 'VOIDED', 'REFUNDED', 'PARTIAL_REFUNDED');

-- CreateEnum
CREATE TYPE "TenderType" AS ENUM ('CASH', 'CARD', 'MOBILE_MONEY', 'BANK_TRANSFER', 'SPLIT', 'CREDIT');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameLocal" TEXT,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "currency" TEXT NOT NULL DEFAULT 'MMK',
    "locale" TEXT NOT NULL DEFAULT 'my-MM',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Yangon',
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "phone" TEXT,
    "taxId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "pin" TEXT,
    "name" TEXT NOT NULL,
    "nameLocal" TEXT,
    "role" "Role" NOT NULL DEFAULT 'CASHIER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outlets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameLocal" TEXT,
    "address" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Yangon',
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "outlets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_materials" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "nameLocal" TEXT,
    "category" "MaterialCategory" NOT NULL,
    "storageZone" "StorageZone" NOT NULL DEFAULT 'DRY',
    "baseUnit" "Unit" NOT NULL,
    "trackBy" "TrackingMode" NOT NULL DEFAULT 'WEIGHT',
    "replenishOnly" BOOLEAN NOT NULL DEFAULT false,
    "tracksExpiry" BOOLEAN NOT NULL DEFAULT false,
    "enforceFifo" BOOLEAN NOT NULL DEFAULT false,
    "parLevel" DECIMAL(12,4),
    "lastUnitCost" DECIMAL(14,4),
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "raw_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_conversions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "materialId" TEXT,
    "fromUnit" "Unit" NOT NULL,
    "toUnit" "Unit" NOT NULL,
    "factor" DECIMAL(16,8) NOT NULL,

    CONSTRAINT "unit_conversions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sellable_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sku" TEXT,
    "name" TEXT NOT NULL,
    "nameLocal" TEXT,
    "category" "ItemCategory" NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "taxRate" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "imageUrl" TEXT,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "sellable_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modifiers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameLocal" TEXT,
    "group" TEXT NOT NULL,
    "priceDelta" DECIMAL(12,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "modifiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_modifiers" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "modifierId" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "item_modifiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "activeFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activeTo" TIMESTAMP(3),
    "yield" DECIMAL(12,4) NOT NULL,
    "yieldUnit" "Unit" NOT NULL,
    "wasteFactor" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_ingredients" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "materialId" TEXT,
    "subRecipeId" TEXT,
    "quantity" DECIMAL(14,4) NOT NULL,
    "unit" "Unit" NOT NULL,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "recipe_ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_batches" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "outletId" TEXT,
    "materialId" TEXT NOT NULL,
    "supplierId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiryDate" TIMESTAMP(3),
    "unitCost" DECIMAL(14,4) NOT NULL,
    "receivedQty" DECIMAL(14,4) NOT NULL,
    "remainingQty" DECIMAL(14,4) NOT NULL,
    "invoiceRef" TEXT,

    CONSTRAINT "stock_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "outletId" TEXT,
    "materialId" TEXT NOT NULL,
    "batchId" TEXT,
    "kind" "MovementKind" NOT NULL,
    "reason" "MovementReason" NOT NULL,
    "qty" DECIMAL(14,4) NOT NULL,
    "unit" "Unit" NOT NULL,
    "saleId" TEXT,
    "saleLineId" TEXT,
    "wasteId" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waste_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "qty" DECIMAL(14,4) NOT NULL,
    "unit" "Unit" NOT NULL,
    "unitCost" DECIMAL(14,4),
    "totalCost" DECIMAL(14,2),
    "reason" "WasteReason" NOT NULL,
    "note" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waste_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_transactions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "outletId" TEXT,
    "shiftId" TEXT,
    "deviceId" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "cashierId" TEXT,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "taxTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discountTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "tenderType" "TenderType" NOT NULL,
    "tenderDetails" JSONB,
    "amountTendered" DECIMAL(14,2),
    "changeGiven" DECIMAL(14,2),
    "status" "SaleStatus" NOT NULL DEFAULT 'COMPLETED',
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "serverReceivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_lines" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "itemNameSnapshot" TEXT NOT NULL,
    "qty" DECIMAL(10,4) NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "modifierDeltas" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(14,2) NOT NULL,
    "modifiersSnapshot" JSONB,
    "notes" TEXT,
    "recipeVersion" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sale_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "outletId" TEXT,
    "userId" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "openingFloat" DECIMAL(14,2) NOT NULL,
    "countedCash" DECIMAL(14,2),
    "expectedCash" DECIMAL(14,2),
    "cashVariance" DECIMAL(14,2),
    "totalSales" DECIMAL(14,2),
    "totalTax" DECIMAL(14,2),
    "totalDiscount" DECIMAL(14,2),
    "saleCount" INTEGER,
    "notes" TEXT,
    "pdfUrl" TEXT,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "users_tenantId_idx" ON "users"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenantId_email_key" ON "users"("tenantId", "email");

-- CreateIndex
CREATE INDEX "outlets_tenantId_idx" ON "outlets"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "outlets_tenantId_name_key" ON "outlets"("tenantId", "name");

-- CreateIndex
CREATE INDEX "raw_materials_tenantId_idx" ON "raw_materials"("tenantId");

-- CreateIndex
CREATE INDEX "raw_materials_tenantId_category_idx" ON "raw_materials"("tenantId", "category");

-- CreateIndex
CREATE INDEX "raw_materials_tenantId_storageZone_idx" ON "raw_materials"("tenantId", "storageZone");

-- CreateIndex
CREATE UNIQUE INDEX "raw_materials_tenantId_name_key" ON "raw_materials"("tenantId", "name");

-- CreateIndex
CREATE INDEX "unit_conversions_tenantId_idx" ON "unit_conversions"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "unit_conversions_tenantId_materialId_fromUnit_toUnit_key" ON "unit_conversions"("tenantId", "materialId", "fromUnit", "toUnit");

-- CreateIndex
CREATE INDEX "sellable_items_tenantId_idx" ON "sellable_items"("tenantId");

-- CreateIndex
CREATE INDEX "sellable_items_tenantId_category_active_idx" ON "sellable_items"("tenantId", "category", "active");

-- CreateIndex
CREATE UNIQUE INDEX "sellable_items_tenantId_name_key" ON "sellable_items"("tenantId", "name");

-- CreateIndex
CREATE INDEX "modifiers_tenantId_idx" ON "modifiers"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "modifiers_tenantId_group_name_key" ON "modifiers"("tenantId", "group", "name");

-- CreateIndex
CREATE UNIQUE INDEX "item_modifiers_itemId_modifierId_key" ON "item_modifiers"("itemId", "modifierId");

-- CreateIndex
CREATE INDEX "recipes_tenantId_idx" ON "recipes"("tenantId");

-- CreateIndex
CREATE INDEX "recipes_tenantId_itemId_activeFrom_idx" ON "recipes"("tenantId", "itemId", "activeFrom");

-- CreateIndex
CREATE INDEX "recipe_ingredients_recipeId_idx" ON "recipe_ingredients"("recipeId");

-- CreateIndex
CREATE INDEX "suppliers_tenantId_idx" ON "suppliers"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_tenantId_name_key" ON "suppliers"("tenantId", "name");

-- CreateIndex
CREATE INDEX "stock_batches_tenantId_materialId_receivedAt_idx" ON "stock_batches"("tenantId", "materialId", "receivedAt");

-- CreateIndex
CREATE INDEX "stock_batches_tenantId_expiryDate_idx" ON "stock_batches"("tenantId", "expiryDate");

-- CreateIndex
CREATE INDEX "stock_movements_tenantId_materialId_createdAt_idx" ON "stock_movements"("tenantId", "materialId", "createdAt");

-- CreateIndex
CREATE INDEX "stock_movements_tenantId_saleId_idx" ON "stock_movements"("tenantId", "saleId");

-- CreateIndex
CREATE INDEX "stock_movements_tenantId_reason_createdAt_idx" ON "stock_movements"("tenantId", "reason", "createdAt");

-- CreateIndex
CREATE INDEX "waste_entries_tenantId_createdAt_idx" ON "waste_entries"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "waste_entries_tenantId_reason_createdAt_idx" ON "waste_entries"("tenantId", "reason", "createdAt");

-- CreateIndex
CREATE INDEX "sale_transactions_tenantId_createdAt_idx" ON "sale_transactions"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "sale_transactions_tenantId_shiftId_idx" ON "sale_transactions"("tenantId", "shiftId");

-- CreateIndex
CREATE INDEX "sale_transactions_tenantId_status_createdAt_idx" ON "sale_transactions"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "sale_transactions_tenantId_deviceId_receiptNumber_key" ON "sale_transactions"("tenantId", "deviceId", "receiptNumber");

-- CreateIndex
CREATE INDEX "sale_lines_saleId_idx" ON "sale_lines"("saleId");

-- CreateIndex
CREATE INDEX "shifts_tenantId_openedAt_idx" ON "shifts"("tenantId", "openedAt");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outlets" ADD CONSTRAINT "outlets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_materials" ADD CONSTRAINT "raw_materials_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_conversions" ADD CONSTRAINT "unit_conversions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sellable_items" ADD CONSTRAINT "sellable_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modifiers" ADD CONSTRAINT "modifiers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_modifiers" ADD CONSTRAINT "item_modifiers_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "sellable_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_modifiers" ADD CONSTRAINT "item_modifiers_modifierId_fkey" FOREIGN KEY ("modifierId") REFERENCES "modifiers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "sellable_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "raw_materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_subRecipeId_fkey" FOREIGN KEY ("subRecipeId") REFERENCES "recipes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "outlets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "raw_materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "outlets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "raw_materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_entries" ADD CONSTRAINT "waste_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_entries" ADD CONSTRAINT "waste_entries_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "raw_materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_transactions" ADD CONSTRAINT "sale_transactions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_transactions" ADD CONSTRAINT "sale_transactions_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "outlets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_transactions" ADD CONSTRAINT "sale_transactions_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sale_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "sellable_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "outlets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

