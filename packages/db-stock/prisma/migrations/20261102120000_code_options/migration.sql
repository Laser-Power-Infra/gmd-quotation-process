-- CreateTable
CREATE TABLE "RmCodeOption" (
    "id" TEXT NOT NULL,
    "erpItemCode" TEXT NOT NULL,
    "itemName" TEXT,
    "l8Category" TEXT,

    CONSTRAINT "RmCodeOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BomCodeOption" (
    "id" TEXT NOT NULL,
    "bomId" TEXT NOT NULL,
    "valveType" TEXT,
    "size" TEXT,
    "pn" TEXT,
    "bomType" TEXT NOT NULL,
    "erpItemCode" TEXT NOT NULL,

    CONSTRAINT "BomCodeOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RmCodeOption_erpItemCode_key" ON "RmCodeOption"("erpItemCode");

-- CreateIndex
CREATE INDEX "BomCodeOption_valveType_size_pn_idx" ON "BomCodeOption"("valveType", "size", "pn");
