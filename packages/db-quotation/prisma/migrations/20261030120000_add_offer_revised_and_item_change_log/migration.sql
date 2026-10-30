-- AlterTable
ALTER TABLE "Enquiry" ADD COLUMN     "offerRevised" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ItemChangeLog" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "enquiryId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "changedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemChangeLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ItemChangeLog_itemId_idx" ON "ItemChangeLog"("itemId");
