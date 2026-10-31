-- AlterTable
ALTER TABLE "LookupOption" ADD COLUMN     "code" TEXT,
ADD COLUMN     "defaultState" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "LookupOption_code_key" ON "LookupOption"("code");
