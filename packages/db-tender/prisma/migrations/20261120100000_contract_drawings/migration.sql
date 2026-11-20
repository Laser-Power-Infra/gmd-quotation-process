-- CreateTable
CREATE TABLE "ContractDrawing" (
    "id" TEXT NOT NULL,
    "contractNo" TEXT NOT NULL,
    "drawingNo" TEXT NOT NULL,
    "rev" INTEGER NOT NULL,
    "docType" TEXT NOT NULL,
    "product" TEXT,
    "pn" TEXT,
    "standard" TEXT,
    "flangeDrilling" TEXT,
    "preparedBy" TEXT,
    "remarks" TEXT,
    "itemCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL,
    "statusAt" TIMESTAMP(3) NOT NULL,
    "statusBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractDrawing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractDrawingEvent" (
    "id" TEXT NOT NULL,
    "drawingId" TEXT NOT NULL,
    "status" TEXT,
    "comment" TEXT,
    "fileName" TEXT,
    "fileUrl" TEXT,
    "sha256" TEXT,
    "final" BOOLEAN NOT NULL DEFAULT false,
    "by" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractDrawingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContractDrawing_contractNo_idx" ON "ContractDrawing"("contractNo");

-- CreateIndex
CREATE UNIQUE INDEX "ContractDrawing_drawingNo_rev_key" ON "ContractDrawing"("drawingNo", "rev");

-- CreateIndex
CREATE UNIQUE INDEX "ContractDrawingEvent_drawingId_sha256_key" ON "ContractDrawingEvent"("drawingId", "sha256");

-- AddForeignKey
ALTER TABLE "ContractDrawingEvent" ADD CONSTRAINT "ContractDrawingEvent_drawingId_fkey" FOREIGN KEY ("drawingId") REFERENCES "ContractDrawing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
