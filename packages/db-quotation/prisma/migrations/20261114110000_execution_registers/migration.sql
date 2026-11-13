-- CreateTable
CREATE TABLE "McRegisterLine" (
    "id" TEXT NOT NULL,
    "mcNo" TEXT NOT NULL,
    "slNo" TEXT,
    "contractNo" TEXT,
    "contractSlNo" TEXT,
    "itemCode" TEXT,
    "itemName" TEXT,
    "partyItemName" TEXT,
    "bomId" TEXT,
    "accCode" TEXT,
    "party" TEXT,
    "orderedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cancelledQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "billedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "balanceQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "inspOfferedQty" DOUBLE PRECISION,
    "inspectedQty" DOUBLE PRECISION,
    "rate" DOUBLE PRECISION,
    "status" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McRegisterLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionRegisterLine" (
    "id" TEXT NOT NULL,
    "prodOrderNo" TEXT NOT NULL,
    "prodOrderDate" TEXT,
    "mcNo" TEXT,
    "itemCode" TEXT NOT NULL,
    "itemName" TEXT,
    "bomId" TEXT,
    "orderedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "producedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "balanceQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "entries" INTEGER NOT NULL DEFAULT 0,
    "lastEntryDate" TEXT,
    "status" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionRegisterLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "McRegisterLine_mcNo_idx" ON "McRegisterLine"("mcNo");
