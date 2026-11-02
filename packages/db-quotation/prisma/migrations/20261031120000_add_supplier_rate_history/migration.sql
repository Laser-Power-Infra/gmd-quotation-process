-- CreateTable
CREATE TABLE "SupplierRateHistory" (
    "id" TEXT NOT NULL,
    "erpItemCode" TEXT NOT NULL,
    "oldUsd" DOUBLE PRECISION,
    "newUsd" DOUBLE PRECISION,
    "oldCost" DOUBLE PRECISION,
    "newCost" DOUBLE PRECISION,
    "supplier" TEXT,
    "offerNo" TEXT,
    "offerDate" TIMESTAMP(3),
    "changedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierRateHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierRateHistory_erpItemCode_idx" ON "SupplierRateHistory"("erpItemCode");
