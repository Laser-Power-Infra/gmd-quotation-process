-- CreateTable
CREATE TABLE "ServiceItem" (
    "itemCode" TEXT NOT NULL,
    "itemName" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceItem_pkey" PRIMARY KEY ("itemCode")
);
