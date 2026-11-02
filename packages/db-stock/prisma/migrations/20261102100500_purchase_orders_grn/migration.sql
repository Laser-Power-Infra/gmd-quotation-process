-- AlterTable (IF NOT EXISTS: some databases got these columns from an earlier
-- unmerged migration, 20261102090000_purchase_order_line_rates)
ALTER TABLE "PurchaseOrderLine" ADD COLUMN IF NOT EXISTS "lastPoDate" TEXT,
ADD COLUMN IF NOT EXISTS "lastPoRate" TEXT,
ADD COLUMN IF NOT EXISTS "minPoRate" TEXT;

-- CreateTable
CREATE TABLE "GrnLine" (
    "id" TEXT NOT NULL,
    "mainPostName" TEXT,
    "accCode" TEXT,
    "vrNo" TEXT NOT NULL,
    "vrDate" TEXT,
    "itemCode" TEXT,
    "partyBillNo" TEXT,
    "partyBillDate" TEXT,
    "orderVrNo" TEXT,
    "orderSlNo" TEXT,
    "qtyRecd" DOUBLE PRECISION,
    "purValue" DOUBLE PRECISION,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrnLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GrnLine_orderVrNo_orderSlNo_idx" ON "GrnLine"("orderVrNo", "orderSlNo");
