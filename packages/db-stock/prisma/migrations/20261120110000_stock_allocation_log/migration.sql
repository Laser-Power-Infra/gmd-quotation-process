-- Append-only log of StockAllocation writes (who, when, old and new qty). No foreign key: removing a booking keeps its history.
CREATE TABLE "StockAllocationLog" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "by" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "contractNo" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "erpCode" TEXT NOT NULL,
    "location" TEXT,
    "oldQty" DOUBLE PRECISION,
    "newQty" DOUBLE PRECISION,
    "note" TEXT,

    CONSTRAINT "StockAllocationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockAllocationLog_at_idx" ON "StockAllocationLog"("at");

-- CreateIndex
CREATE INDEX "StockAllocationLog_contractNo_itemCode_idx" ON "StockAllocationLog"("contractNo", "itemCode");
