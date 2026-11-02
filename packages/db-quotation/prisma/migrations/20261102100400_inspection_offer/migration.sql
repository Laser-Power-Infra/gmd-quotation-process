-- CreateTable
CREATE TABLE "InspectionOffer" (
    "id" TEXT NOT NULL,
    "vrno" TEXT NOT NULL,
    "vrDate" TEXT,
    "accCode" TEXT,
    "contractVrno" TEXT,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InspectionOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspectionReport" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InspectionReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InspectionOffer_vrno_key" ON "InspectionOffer"("vrno");

-- CreateIndex
CREATE UNIQUE INDEX "InspectionReport_offerId_key" ON "InspectionReport"("offerId");

-- AddForeignKey
ALTER TABLE "InspectionReport" ADD CONSTRAINT "InspectionReport_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "InspectionOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
