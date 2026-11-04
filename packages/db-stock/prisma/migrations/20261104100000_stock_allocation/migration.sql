-- CreateTable
CREATE TABLE "StockAllocation" (
    "id" TEXT NOT NULL,
    "erpCode" TEXT NOT NULL,
    "location" TEXT,
    "contractNo" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "basis" TEXT,
    "remarks" TEXT,
    "allocatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockAllocation_erpCode_idx" ON "StockAllocation"("erpCode");

-- CreateIndex
CREATE INDEX "StockAllocation_contractNo_itemCode_idx" ON "StockAllocation"("contractNo", "itemCode");
