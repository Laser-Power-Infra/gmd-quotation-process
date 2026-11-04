-- AlterTable
ALTER TABLE "Bom" ADD COLUMN     "reopenedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "BomChange" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "bomId" TEXT,
    "itemCode" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    "note" TEXT,
    "source" TEXT,
    "createdBy" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BomChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BomChange_status_idx" ON "BomChange"("status");

-- CreateIndex
CREATE INDEX "BomChange_itemCode_idx" ON "BomChange"("itemCode");
