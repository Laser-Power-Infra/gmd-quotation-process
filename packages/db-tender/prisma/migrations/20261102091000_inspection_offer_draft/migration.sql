-- CreateTable
CREATE TABLE "InspectionOffer" (
    "id" TEXT NOT NULL,
    "vrno" TEXT NOT NULL,
    "vrdate" TEXT,
    "contractNo" TEXT,
    "inspeDate" TEXT,
    "rows" JSONB NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InspectionOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspectionReportDraft" (
    "id" TEXT NOT NULL,
    "offerVrno" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "header" JSONB NOT NULL,
    "items" JSONB NOT NULL,
    "issues" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InspectionReportDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InspectionOffer_vrno_key" ON "InspectionOffer"("vrno");

-- CreateIndex
CREATE UNIQUE INDEX "InspectionReportDraft_offerVrno_key" ON "InspectionReportDraft"("offerVrno");
