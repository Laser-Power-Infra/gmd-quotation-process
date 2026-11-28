-- Allocation of a purchase line's qty to a contract line. Keyed on the purchase line (poNo + poLineNo); lot, invoice, B/L and ETA are reference text only.
CREATE TABLE "PurchaseAllocation" (
    "id" TEXT NOT NULL,
    "poNo" TEXT NOT NULL,
    "poLineNo" TEXT NOT NULL,
    "contractNo" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "lot" TEXT,
    "tinaInvoiceNo" TEXT,
    "blNo" TEXT,
    "eta" TEXT,
    "shipStatus" TEXT,
    "needsConfirmation" BOOLEAN NOT NULL DEFAULT false,
    "remarks" TEXT,
    "source" TEXT NOT NULL,
    "allocatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseAllocation_poNo_poLineNo_contractNo_itemCode_key" ON "PurchaseAllocation"("poNo", "poLineNo", "contractNo", "itemCode");

-- CreateIndex
CREATE INDEX "PurchaseAllocation_contractNo_itemCode_idx" ON "PurchaseAllocation"("contractNo", "itemCode");
