/*
  Warnings:

  - You are about to drop the `debtors` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "debtors";

-- CreateTable
CREATE TABLE "Debtor" (
    "id" TEXT NOT NULL,
    "accSch" TEXT,
    "accCode" TEXT NOT NULL,
    "tCode" TEXT,
    "vrNo" TEXT,
    "drAmt" DECIMAL(65,30),
    "vrDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "particular" TEXT,
    "drAllocAmt" DECIMAL(18,2),
    "unAllocDr" DECIMAL(18,2),
    "unAllocCr" DECIMAL(18,2),
    "partyBillNo" TEXT,
    "partyBillDate" TIMESTAMP(3),
    "accName" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Debtor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Debtor_dueDate_idx" ON "Debtor"("dueDate");

-- CreateIndex
CREATE INDEX "Debtor_accCode_idx" ON "Debtor"("accCode");

-- CreateIndex
CREATE UNIQUE INDEX "Debtor_accCode_tCode_vrNo_key" ON "Debtor"("accCode", "tCode", "vrNo");
