-- CreateTable
CREATE TABLE "FgBomOption" (
    "id" TEXT NOT NULL,
    "fgCode" TEXT NOT NULL,
    "bomId" TEXT NOT NULL,
    "itemType" TEXT,
    "moc" TEXT,
    "size" TEXT,

    CONSTRAINT "FgBomOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FgBomOption_fgCode_idx" ON "FgBomOption"("fgCode");
