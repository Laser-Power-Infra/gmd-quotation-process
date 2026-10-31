-- CreateTable
CREATE TABLE "SaleBill" (
    "id" TEXT NOT NULL,
    "vrNo" TEXT NOT NULL,
    "orderVrNo" TEXT,
    "partyRefNo" TEXT,
    "consigneeCode" TEXT,
    "consigneeAdd" TEXT,
    "itemCode" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaleBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleRegister" (
    "id" TEXT NOT NULL,
    "invoiceNo" TEXT NOT NULL,
    "itemName" TEXT,
    "orderCopy" TEXT,
    "invoice" TEXT,
    "inspectionReport" TEXT,
    "driveLink" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaleRegister_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankGuarantee" (
    "id" TEXT NOT NULL,
    "bgNo" TEXT,
    "bgAmt" DECIMAL(18,2),
    "cancelledStatus" TEXT,
    "beneficiaryName" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankGuarantee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SaleBill_vrNo_idx" ON "SaleBill"("vrNo");

-- CreateIndex
CREATE INDEX "SaleRegister_invoiceNo_idx" ON "SaleRegister"("invoiceNo");

-- CreateIndex
CREATE INDEX "BankGuarantee_beneficiaryName_idx" ON "BankGuarantee"("beneficiaryName");
