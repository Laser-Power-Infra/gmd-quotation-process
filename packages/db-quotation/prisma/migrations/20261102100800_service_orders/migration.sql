-- CreateTable
CREATE TABLE "GrnLine" (
    "id" TEXT NOT NULL,
    "mainPostName" TEXT,
    "accCode" TEXT,
    "vrno" TEXT NOT NULL,
    "vrdate" TEXT,
    "itemCode" TEXT,
    "partybillno" TEXT,
    "partybilldate" TEXT,
    "orderVrno" TEXT,
    "orderSlno" TEXT,
    "qtyrecd" TEXT,
    "purValue" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrnLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceItem" (
    "itemCode" TEXT NOT NULL,
    "itemName" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceItem_pkey" PRIMARY KEY ("itemCode")
);

-- CreateIndex
CREATE INDEX "GrnLine_itemCode_idx" ON "GrnLine"("itemCode");

-- CreateIndex
CREATE INDEX "GrnLine_orderVrno_orderSlno_idx" ON "GrnLine"("orderVrno", "orderSlno");
