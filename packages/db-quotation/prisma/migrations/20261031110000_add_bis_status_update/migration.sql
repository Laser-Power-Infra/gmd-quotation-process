-- CreateTable
CREATE TABLE "BisStatusUpdate" (
    "id" TEXT NOT NULL,
    "bisStatusId" TEXT NOT NULL,
    "status" TEXT,
    "nextStep" TEXT,
    "nextDate" TIMESTAMP(3),
    "remark" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BisStatusUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BisStatusUpdate_bisStatusId_idx" ON "BisStatusUpdate"("bisStatusId");

-- AddForeignKey
ALTER TABLE "BisStatusUpdate" ADD CONSTRAINT "BisStatusUpdate_bisStatusId_fkey" FOREIGN KEY ("bisStatusId") REFERENCES "BisStatus"("id") ON DELETE CASCADE ON UPDATE CASCADE;
